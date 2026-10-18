/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
import { useEffect, type RefObject } from 'react'

import wallpaper from '@/assets/home-observatory.png'

import {
  coverImageRect,
  createGlassRenderer,
  GLASS_MATERIALS,
  PRIMARY_TINT,
  type GlassMaterial,
  type GlassRect,
} from '../lib/glass-renderer'
import { detectGlassTier } from '../lib/glass-tier'

/** Shader glass is limited to the fixed navigation and the hero: a canvas
 *  that scrolls with the page always trails the compositor by a frame, so
 *  the panels below the hero keep their CSS frosted glass instead. */
const SURFACE_SELECTOR =
  'header nav, .home-metrics, .home-hero .home-hero-actions [data-slot=button]'
/** The canvas reaches this far past the element so the rim sits on its border. */
const OUTSET = 1
/** Open a WebGL context this many viewport heights before the screen and
 *  release it this far after; browsers evict the oldest context once a page
 *  holds more than about 16, and the gap keeps a surface sitting on the edge
 *  from opening and closing contexts on every small scroll. */
const CONTEXT_OPEN = 0.5
const CONTEXT_RELEASE = 1.5
/** Hard ceiling on live contexts, comfortably under the browser's ~16 (a
 *  sixteenth context evicts the oldest one and the surfaces start fighting).
 *  Surfaces beyond the budget keep their CSS glass until one frees up. */
export const MAX_GLASS_CONTEXTS = 10
/** A context that fails to open (typically because the browser has not yet
 *  released the previous page's contexts) is retried on a fresh canvas with
 *  this backoff, so a surface is never written off for good. */
const RETRY_BASE_MS = 500
const RETRY_MAX_MS = 15000
/** Surfaces switch to the shader this far before they scroll into view, so
 *  the change never happens in front of the reader. */
const DRAW_LEAD = 0.25
/** Same-origin copy of the random wallpaper; the picture service has no CORS. */
export const HOME_WALLPAPER_URL = '/api/home/wallpaper'

function materialFor(element: HTMLElement): GlassMaterial {
  if (element.closest('header')) return GLASS_MATERIALS.bar
  if (element.matches('[data-slot=button]')) {
    if (element.classList.contains('home-primary')) {
      return { ...GLASS_MATERIALS.button, tint: PRIMARY_TINT }
    }
    return GLASS_MATERIALS.button
  }
  return GLASS_MATERIALS.card
}

type GlassSurface = {
  element: HTMLElement
  canvas: HTMLCanvasElement
  material: GlassMaterial
  /** The navigation's glass lies beneath the page content so the pill's own
   *  backdrop blur can soften whatever scrolls under it on top of the refraction. */
  underContent: boolean
  renderer: ReturnType<typeof createGlassRenderer>
  failures: number
  retryAt: number
  /** Corner radius read from CSS once per layout, not per frame. */
  radius: number | null
  /** Last geometry written to an under-content canvas, to skip idle writes. */
  placement: string | null
  /** Where the surface was last frame, to predict where the compositor
   *  will show it next frame (see draw). */
  lastX: number | null
  lastY: number | null
  /** When lastX/lastY were sampled; a stale sample cannot predict a delta. */
  lastAt: number
  cleanup: () => void
}

/** Wallpaper-backed optical glass on every glass surface of the home page. */
export function useWebglGlass(rootRef: RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const root = rootRef.current
    const backdrop = root?.querySelector<HTMLElement>('.home-backdrop')
    const hero = root?.querySelector<HTMLElement>('.home-hero')
    if (!root || !backdrop || !hero) return
    const tier = detectGlassTier()
    root.dataset.glassTier = tier
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)')
    const transparency = window.matchMedia(
      '(prefers-reduced-transparency: reduce)'
    )
    const image = new Image()
    const abort = new AbortController()
    let objectUrl: string | null = null
    let disposed = false
    let frame = 0
    let retryTimer = 0
    const surfaces: GlassSurface[] = []

    // A fresh canvas per context: a deliberately lost context cannot be
    // reopened on the same element, so far-away surfaces get a new one.
    const mountCanvas = (surface: GlassSurface) => {
      surface.cleanup()
      const canvas = document.createElement('canvas')
      canvas.className = surface.underContent
        ? 'home-optical-glass home-optical-glass-under'
        : 'home-optical-glass'
      canvas.setAttribute('aria-hidden', 'true')
      if (surface.underContent) {
        // Right after the backdrop: beneath the content, and the layout
        // wrapper stays the root's last child for the stylesheet.
        backdrop.after(canvas)
      } else {
        surface.element.prepend(canvas)
      }
      surface.canvas = canvas
      surface.placement = null
      const lost = (event: Event) => {
        event.preventDefault()
        surface.renderer?.dispose()
        surface.renderer = null
        delete surface.element.dataset.glassRenderer
        // A lost context cannot be reopened on the same element, so the
        // surface gets a fresh canvas instead of retrying a dead one.
        mountCanvas(surface)
        schedule()
      }
      canvas.addEventListener('webglcontextlost', lost)
      canvas.addEventListener('webglcontextrestored', schedule)
      surface.cleanup = () => {
        canvas.removeEventListener('webglcontextlost', lost)
        canvas.removeEventListener('webglcontextrestored', schedule)
        surface.renderer?.dispose(true)
        surface.renderer = null
        canvas.remove()
        delete surface.element.dataset.glassRenderer
      }
    }
    // Style reads force a style recalculation, so the values that only change
    // with the layout are refreshed on resize rather than every frame.
    let backdropAnchor = 0.5
    const relayout = () => {
      backdropAnchor =
        Number.parseFloat(getComputedStyle(backdrop).backgroundPositionX) / 100
      for (const surface of surfaces) surface.radius = null
    }
    const draw = () => {
      frame = 0
      if (disposed || document.hidden) return
      const heroRect = hero.getBoundingClientRect()
      const imageRect = coverImageRect(
        { width: image.naturalWidth, height: image.naturalHeight },
        backdrop.getBoundingClientRect(),
        backdropAnchor
      )
      const viewportHeight = window.innerHeight
      const now = performance.now()
      const rects = surfaces.map((surface) => {
        const box = surface.element.getBoundingClientRect()
        return {
          x: box.left - OUTSET,
          y: box.top - OUTSET,
          width: box.width + 2 * OUTSET,
          height: box.height + 2 * OUTSET,
        }
      })
      const within = (rect: GlassRect, reach: number) =>
        rect.y + rect.height > -viewportHeight * reach &&
        rect.y < viewportHeight * (1 + reach)
      const distance = (rect: GlassRect) =>
        Math.abs(rect.y + rect.height / 2 - viewportHeight / 2)
      const release = (surface: GlassSurface) => {
        surface.renderer?.dispose(true)
        surface.renderer = null
        mountCanvas(surface)
      }
      // Contexts are opened while a surface is still approaching, so the
      // shader compile never lands in the middle of a scroll on screen, and
      // handed out nearest-first within the budget.
      surfaces.forEach((surface, index) => {
        if (surface.renderer && !within(rects[index], CONTEXT_RELEASE)) {
          release(surface)
        }
      })
      const holders = () => surfaces.filter((surface) => surface.renderer)
      const candidates = surfaces
        .map((surface, index) => ({ surface, rect: rects[index] }))
        .filter(
          ({ surface, rect }) =>
            !surface.renderer &&
            now >= surface.retryAt &&
            within(rect, CONTEXT_OPEN)
        )
        .sort((a, b) => distance(a.rect) - distance(b.rect))
      for (const { surface, rect } of candidates) {
        const live = holders()
        if (live.length >= MAX_GLASS_CONTEXTS) {
          const farthest = live
            .map((holder) => ({
              holder,
              distance: distance(rects[surfaces.indexOf(holder)]),
            }))
            .sort((a, b) => b.distance - a.distance)[0]
          if (
            !farthest ||
            farthest.distance < distance(rect) + viewportHeight * 0.25
          ) {
            continue
          }
          release(farthest.holder)
        }
        surface.renderer = createGlassRenderer(surface.canvas, image)
        if (surface.renderer) {
          surface.failures = 0
          continue
        }
        // Usually a context the browser has not released yet: try again on a
        // fresh canvas after a growing pause.
        surface.failures += 1
        surface.retryAt =
          now + Math.min(RETRY_BASE_MS * 2 ** surface.failures, RETRY_MAX_MS)
        mountCanvas(surface)
      }
      let visible = false
      surfaces.forEach((surface, index) => {
        const rect = rects[index]
        const header = surface.element.closest('header')
        // The navigation sits clear on the wallpaper at the top of the page
        // and only turns to glass once the page scrolls. From then on every
        // surface is shader-drawn while on screen: the wallpaper is fixed
        // behind the whole page, so there is always something to refract.
        // Hero surfaces stop once they scroll out of the hero.
        const atTop = !!header && !header.hasAttribute('data-scrolled')
        const onScreen =
          rect.width > 0 &&
          rect.height > 0 &&
          rect.y + rect.height > -viewportHeight * DRAW_LEAD &&
          rect.y < viewportHeight * (1 + DRAW_LEAD)
        const wanted =
          !atTop &&
          !transparency.matches &&
          onScreen &&
          (!surface.element.closest('.home-hero') ||
            rect.y + rect.height <= heroRect.bottom)
        // A canvas that scrolls with the page is positioned by the compositor,
        // which is one frame ahead of the scroll offset this code sees, so a
        // wallpaper sampled at the surface's current position shows up a frame
        // late. Sample where the surface will be next frame instead: the
        // compositor keeps applying the same delta during a smooth scroll.
        let aheadX = 0
        let aheadY = 0
        if (!surface.underContent) {
          // A sample older than this came from before a paused frame loop
          // (reduced motion, a hidden tab), so its delta is not a scroll.
          if (
            surface.lastX !== null &&
            surface.lastY !== null &&
            now - surface.lastAt <= 100
          ) {
            const limit = viewportHeight * 0.5
            aheadX = Math.max(
              -limit,
              Math.min(limit, rect.x - surface.lastX)
            )
            aheadY = Math.max(
              -limit,
              Math.min(limit, rect.y - surface.lastY)
            )
          }
          surface.lastX = rect.x
          surface.lastY = rect.y
          surface.lastAt = now
        }
        if (!wanted || !surface.renderer) {
          delete surface.element.dataset.glassRenderer
          if (surface.underContent && surface.placement) {
            surface.placement = null
            surface.canvas.style.visibility = 'hidden'
          }
          return
        }
        visible = true
        if (surface.underContent) {
          // Only touch the style when the pill actually moved: a write here
          // would invalidate layout for every rect read later in the frame.
          const placement = `${rect.x}/${rect.y}/${rect.width}/${rect.height}`
          if (surface.placement !== placement) {
            surface.placement = placement
            const canvasStyle = surface.canvas.style
            canvasStyle.left = `${rect.x}px`
            canvasStyle.top = `${rect.y}px`
            canvasStyle.width = `${rect.width}px`
            canvasStyle.height = `${rect.height}px`
            canvasStyle.visibility = 'visible'
          }
        }
        surface.radius ??= Number.parseFloat(
          getComputedStyle(surface.element).borderTopLeftRadius
        )
        // Light the rim from the upper right like the reference until the
        // pointer moves it. The CSS angle is clockwise from the top; the
        // shader measures its light vector from +x with y pointing down.
        const shine = surface.element.style.getPropertyValue('--shine-angle')
        const lightAngle = shine
          ? ((Number.parseFloat(shine) - 90) * Math.PI) / 180
          : -Math.PI / 4
        surface.renderer.draw({
          rect,
          imageRect: {
            ...imageRect,
            x: imageRect.x - aheadX,
            y: imageRect.y - aheadY,
          },
          heroTop: heroRect.top,
          heroHeight: heroRect.height,
          // Beneath the content the page's own scrims already darken the
          // canvas; inside an element the shader has to reproduce the hero's.
          scrim: surface.underContent ? 0 : 1,
          // The canvas is outset from the element, so its corners need the
          // same outset added to stay concentric with the element's border.
          radius: surface.radius + OUTSET,
          lightAngle,
          material: surface.material,
          dpr: window.devicePixelRatio,
        })
        surface.element.dataset.glassRenderer = 'webgl'
      })
      // Only visible glass needs a frame loop. Surfaces waiting out a retry
      // backoff are woken by one timer instead, so a device without WebGL
      // does not spin at display rate for nothing.
      if (!visible || motion.matches) {
        const nextRetry = surfaces
          .filter((surface) => !surface.renderer && surface.failures > 0)
          .map((surface) => surface.retryAt)
          .sort((a, b) => a - b)
          .at(0)
        if (nextRetry !== undefined) {
          retryTimer = window.setTimeout(schedule, Math.max(0, nextRetry - now))
        }
        return
      }
      frame = requestAnimationFrame(draw)
    }
    const schedule = () => {
      cancelAnimationFrame(frame)
      frame = 0
      window.clearTimeout(retryTimer)
      retryTimer = 0
      if (!disposed && !document.hidden && surfaces.length) {
        frame = requestAnimationFrame(draw)
      }
    }
    const loaded = () => {
      if (disposed) return
      // The backdrop shows the same decoded picture the shader samples, so
      // the glass never refracts a different random image than the one behind it.
      backdrop.style.backgroundImage = `url("${image.src}")`
      backdrop.dataset.wallpaper = 'ready'
      // The frosted tier keeps the wallpaper but draws no glass at all.
      if (tier === 'frosted') return
      relayout()
      const elements = root.querySelectorAll<HTMLElement>(SURFACE_SELECTOR)
      for (const element of elements) {
        const surface: GlassSurface = {
          element,
          canvas: document.createElement('canvas'),
          material: materialFor(element),
          underContent: !!element.closest('header'),
          renderer: null,
          failures: 0,
          retryAt: 0,
          radius: null,
          placement: null,
          lastX: null,
          lastY: null,
          lastAt: 0,
          cleanup: () => {},
        }
        mountCanvas(surface)
        surfaces.push(surface)
      }
      schedule()
    }
    image.addEventListener('load', loaded, { once: true })
    // One fetch feeds both the CSS backdrop and the WebGL texture. A plain
    // same-origin fetch matches the preload that index.html starts before this
    // code even loads, so the picture is usually already on its way. The
    // bundled wallpaper stands in when the proxy or the picture service is
    // unavailable.
    fetch(HOME_WALLPAPER_URL, {
      signal: abort.signal,
      credentials: 'same-origin',
    })
      .then((response) => {
        if (
          !response.ok ||
          !response.headers.get('content-type')?.startsWith('image/')
        ) {
          throw new Error('Wallpaper response is not an image')
        }
        return response.blob()
      })
      .then((blob) => {
        if (disposed) return
        objectUrl = URL.createObjectURL(blob)
        image.src = objectUrl
      })
      .catch(() => {
        if (!disposed) image.src = wallpaper
      })
    const resized = () => {
      relayout()
      schedule()
    }
    const resize = new ResizeObserver(resized)
    resize.observe(hero)
    resize.observe(backdrop)
    window.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', resized, { passive: true })
    document.addEventListener('visibilitychange', schedule)
    motion.addEventListener('change', schedule)
    transparency.addEventListener('change', schedule)
    return () => {
      disposed = true
      abort.abort()
      if (objectUrl) URL.revokeObjectURL(objectUrl)
      image.removeEventListener('load', loaded)
      cancelAnimationFrame(frame)
      window.clearTimeout(retryTimer)
      resize.disconnect()
      window.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', resized)
      document.removeEventListener('visibilitychange', schedule)
      motion.removeEventListener('change', schedule)
      transparency.removeEventListener('change', schedule)
      surfaces.forEach((surface) => surface.cleanup())
    }
  }, [rootRef])
}
