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
} from '../lib/glass-renderer'

const SURFACE_SELECTOR =
  'header nav, .home-metrics, .home-hero-actions [data-slot=button]'
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

/** Wallpaper-backed optical glass on the hero; DOM-backed areas retain CSS blur. */
export function useWebglGlass(rootRef: RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const root = rootRef.current
    const backdrop = root?.querySelector<HTMLElement>('.home-backdrop')
    const hero = root?.querySelector<HTMLElement>('.home-hero')
    if (!root || !backdrop || !hero) return
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)')
    const transparency = window.matchMedia(
      '(prefers-reduced-transparency: reduce)'
    )
    const image = new Image()
    const abort = new AbortController()
    let objectUrl: string | null = null
    let disposed = false
    let frame = 0
    const surfaces: {
      element: HTMLElement
      canvas: HTMLCanvasElement
      material: GlassMaterial
      renderer: ReturnType<typeof createGlassRenderer>
      cleanup: () => void
    }[] = []

    const draw = () => {
      frame = 0
      if (disposed || document.hidden) return
      const heroRect = hero.getBoundingClientRect()
      const contentRects = [
        ...hero.querySelectorAll<HTMLElement>(
          '.home-hero-content > *, .home-metrics'
        ),
      ].map((element) => element.getBoundingClientRect())
      const imageRect = coverImageRect(
        { width: image.naturalWidth, height: image.naturalHeight },
        backdrop.getBoundingClientRect(),
        Number.parseFloat(getComputedStyle(backdrop).backgroundPositionX) / 100
      )
      let visible = false
      for (const surface of surfaces) {
        const rect = surface.canvas.getBoundingClientRect()
        const header = surface.element.closest('header')
        // The navigation sits clear on the wallpaper at the top of the page
        // and only turns to glass once the page scrolls.
        const atTop = !!header && !header.hasAttribute('data-scrolled')
        // A shader cannot sample DOM text. Switch the navigation back to native
        // backdrop-filter once it crosses from wallpaper into the content area.
        const coversContent =
          !!header &&
          contentRects.some(
            (content) =>
              rect.left < content.right &&
              rect.right > content.left &&
              rect.top < content.bottom &&
              rect.bottom > content.top
          )
        const active =
          !!surface.renderer &&
          !atTop &&
          !coversContent &&
          !transparency.matches &&
          rect.width > 0 &&
          rect.height > 0 &&
          rect.bottom > 0 &&
          rect.top < window.innerHeight &&
          rect.bottom <= heroRect.bottom
        if (!active) {
          delete surface.element.dataset.glassRenderer
          continue
        }
        visible = true
        const style = getComputedStyle(surface.element)
        // The canvas is outset from the element (see .home-optical-glass), so
        // its corners need the same outset added to stay concentric with the
        // element's own rounded border instead of drawing a second outline.
        const outset =
          (rect.width - surface.element.getBoundingClientRect().width) / 2
        // Light the rim from the upper right like the reference until the
        // pointer moves it. The CSS angle is clockwise from the top; the
        // shader measures its light vector from +x with y pointing down.
        const shine = surface.element.style.getPropertyValue('--shine-angle')
        const lightAngle = shine
          ? ((Number.parseFloat(shine) - 90) * Math.PI) / 180
          : -Math.PI / 4
        surface.renderer?.draw({
          rect,
          imageRect,
          heroTop: heroRect.top,
          heroHeight: heroRect.height,
          radius: Number.parseFloat(style.borderTopLeftRadius) + outset,
          lightAngle,
          material: surface.material,
          dpr: window.devicePixelRatio,
        })
        surface.element.dataset.glassRenderer = 'webgl'
      }
      if (visible && !motion.matches) frame = requestAnimationFrame(draw)
    }
    const schedule = () => {
      cancelAnimationFrame(frame)
      frame = 0
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
      const elements = root.querySelectorAll<HTMLElement>(SURFACE_SELECTOR)
      for (const element of elements) {
        const canvas = document.createElement('canvas')
        canvas.className = 'home-optical-glass'
        canvas.setAttribute('aria-hidden', 'true')
        element.prepend(canvas)
        const surface = {
          element,
          canvas,
          material: materialFor(element),
          renderer: createGlassRenderer(canvas, image),
          cleanup: () => {},
        }
        const lost = (event: Event) => {
          event.preventDefault()
          surface.renderer?.dispose()
          surface.renderer = null
          delete element.dataset.glassRenderer
          schedule()
        }
        const restored = () => {
          surface.renderer = createGlassRenderer(canvas, image)
          schedule()
        }
        canvas.addEventListener('webglcontextlost', lost)
        canvas.addEventListener('webglcontextrestored', restored)
        surface.cleanup = () => {
          canvas.removeEventListener('webglcontextlost', lost)
          canvas.removeEventListener('webglcontextrestored', restored)
          surface.renderer?.dispose(true)
          canvas.remove()
          delete element.dataset.glassRenderer
        }
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
    const resize = new ResizeObserver(schedule)
    resize.observe(hero)
    resize.observe(backdrop)
    window.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', schedule, { passive: true })
    document.addEventListener('visibilitychange', schedule)
    motion.addEventListener('change', schedule)
    transparency.addEventListener('change', schedule)
    return () => {
      disposed = true
      abort.abort()
      if (objectUrl) URL.revokeObjectURL(objectUrl)
      image.removeEventListener('load', loaded)
      cancelAnimationFrame(frame)
      resize.disconnect()
      window.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
      document.removeEventListener('visibilitychange', schedule)
      motion.removeEventListener('change', schedule)
      transparency.removeEventListener('change', schedule)
      surfaces.forEach((surface) => surface.cleanup())
    }
  }, [rootRef])
}
