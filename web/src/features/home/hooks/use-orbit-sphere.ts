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

const SPIN = 0.07 // radians per second
const TILT = 0.36 // axis leans toward the viewer so parallels read as ellipses
const PARALLELS = [-60, -40, -20, 0, 20, 40, 60]
const MERIDIANS = 9
const SEGMENTS = 96
const DOTS = 720
const BEADS = 3
/** API log fragments drift around the globe like model chips on the reference. */
export const ORBIT_LOG_LINES = [
  'POST /v1/chat/completions · 200 · 118ms',
  '{"role":"assistant","content":"…"}',
  'gpt-4o-mini · 88ms',
  'claude-sonnet-4.5 · $3/M',
  '429 → retry ch-2 · 200 · 96ms',
  'Authorization: Bearer sk-••••',
  '"stream": true',
  'GET /v1/models · 200 · 12ms',
  'data: [DONE]',
  'x-ratelimit-remaining: 982',
  'TTFB 128ms · p99 402ms',
  'POST /v1/embeddings · 200 · 63ms',
]
const CLEARANCE = 14 // px between the limb and the navigation or metrics card

type Point = [number, number, number]
/** A ring around the globe: radius relative to the limb, leaned toward the viewer, then rolled. */
type Ring = { radius: number; lean: number; roll: number; speed: number }

const ORBIT: Ring = { radius: 1.3, lean: 0.48, roll: -0.22, speed: 0.05 }
/** The log lines ride three further rings at different angles and paces. */
const LOG_RINGS: Ring[] = [
  { radius: 1.46, lean: 1.12, roll: 0.34, speed: -0.028 },
  { radius: 1.58, lean: 0.72, roll: 1.28, speed: 0.022 },
  { radius: 1.36, lean: 0.4, roll: -0.95, speed: 0.034 },
]

/** A unit circle in the plane with the given latitude, or a meridian when `meridian` is set. */
function circle(latitude: number, meridian: number | null): Point[] {
  const points: Point[] = []
  for (let index = 0; index <= SEGMENTS; index++) {
    const angle = (index / SEGMENTS) * Math.PI * 2
    if (meridian === null) {
      const ring = Math.cos(latitude)
      points.push([
        ring * Math.cos(angle),
        Math.sin(latitude),
        ring * Math.sin(angle),
      ])
    } else {
      const ring = Math.cos(angle)
      points.push([
        ring * Math.cos(meridian),
        Math.sin(angle),
        ring * Math.sin(meridian),
      ])
    }
  }
  return points
}

const GRID = [
  ...PARALLELS.map((degrees) => circle((degrees * Math.PI) / 180, null)),
  ...Array.from({ length: MERIDIANS }, (_, index) =>
    circle(0, (index / MERIDIANS) * Math.PI)
  ),
]
// Fibonacci sphere: even coverage, with patches thinned out so the surface
// reads like dotted land masses rather than a uniform mesh.
const SURFACE = Array.from({ length: DOTS }, (_, index): Point => {
  const y = 1 - (2 * (index + 0.5)) / DOTS
  const ring = Math.sqrt(1 - y * y)
  const angle = index * 2.39996
  return [ring * Math.cos(angle), y, ring * Math.sin(angle)]
}).filter(
  ([x, y, z]) => Math.sin(3.1 * x + 5.3 * y) * Math.cos(4.2 * z) > -0.35
)
/** A point on a ring at any angle, so riders glide instead of hopping between segments. */
function ringPoint(ring: Ring, angle: number): Point {
  const x = Math.cos(angle)
  const z = Math.sin(angle)
  const leanedY = -z * Math.sin(ring.lean)
  const leanedZ = z * Math.cos(ring.lean)
  return [
    (x * Math.cos(ring.roll) - leanedY * Math.sin(ring.roll)) * ring.radius,
    (x * Math.sin(ring.roll) + leanedY * Math.cos(ring.roll)) * ring.radius,
    leanedZ * ring.radius,
  ]
}
const ORBIT_PATH = Array.from({ length: SEGMENTS + 1 }, (_, index) =>
  ringPoint(ORBIT, (index / SEGMENTS) * Math.PI * 2)
)
const LOG_RIDERS = ORBIT_LOG_LINES.map((text, index) => {
  const ring = LOG_RINGS[index % LOG_RINGS.length]
  const seat = Math.floor(index / LOG_RINGS.length)
  const seats = Math.ceil(ORBIT_LOG_LINES.length / LOG_RINGS.length)
  return { text, ring, phase: seat / seats + (index % LOG_RINGS.length) * 0.11 }
})

/** Wireframe globe behind the hero copy, centred on the title itself. */
export function useOrbitSphere(canvasRef: RefObject<HTMLCanvasElement | null>) {
  useEffect(() => {
    const canvas = canvasRef.current
    const hero = canvas?.parentElement
    const content = hero?.querySelector<HTMLElement>('.home-hero-content')
    const context = canvas?.getContext('2d')
    if (!canvas || !hero || !content || !context) return
    // The stage wrapper never animates, while the title inside it does; a
    // transformed rect would make the whole globe bob with the text.
    const title =
      content.querySelector<HTMLElement>('.home-title-stage') ?? content
    const header = document.querySelector('header')
    const metrics = hero.querySelector('.home-metrics')
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)')
    let yaw = 0.6
    let pitch = 0
    let frame = 0
    let last: number | null = null
    let visible = true
    let drag: { x: number; y: number; yaw: number; pitch: number } | null = null
    // Gradients are expensive to build and only change with the geometry, so
    // they are rebuilt on resize or scroll rather than on every frame.
    let halo: { key: string; gradient: CanvasGradient } | null = null
    let shade: { key: string; gradient: CanvasGradient } | null = null
    // Each rider's label only has a handful of legible sizes; setting the
    // font string every frame forces the canvas to re-parse it.
    let lastFont = ''
    // Surface dots are filled in depth buckets: one path per bucket instead
    // of one path per dot, which is the difference between a smooth globe and
    // a stuttering one on Windows' canvas implementation.
    const dotAlphas = Array.from({ length: 5 }, (_, index) => 0.36 + index * 0.125)

    const draw = (now: number) => {
      frame = 0
      const elapsed = last === null ? 0 : Math.min(0.05, (now - last) / 1000)
      last = now
      if (!drag && !motion.matches) yaw += SPIN * elapsed
      const heroRect = hero.getBoundingClientRect()
      const titleRect = title.getBoundingClientRect()
      const width = heroRect.width
      const height = heroRect.height
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5)
      const pixelWidth = Math.round(width * dpr)
      const pixelHeight = Math.round(height * dpr)
      if (canvas.width !== pixelWidth) {
        canvas.width = pixelWidth
      }
      if (canvas.height !== pixelHeight) {
        canvas.height = pixelHeight
      }
      const centerX = titleRect.left - heroRect.left + titleRect.width / 2
      const centerY = titleRect.top - heroRect.top + titleRect.height / 2
      // Keep the globe clear of the fixed navigation and the metrics card.
      const top = header
        ? Math.max(0, header.getBoundingClientRect().bottom - heroRect.top)
        : 0
      const bottom = metrics
        ? metrics.getBoundingClientRect().top - heroRect.top
        : height
      const radius = Math.max(
        40,
        Math.min(centerY - top, bottom - centerY, width * 0.44, height * 0.34) -
          CLEARANCE
      )
      const cosYaw = Math.cos(yaw)
      const sinYaw = Math.sin(yaw)
      const lean = TILT + pitch
      const cosLean = Math.cos(lean)
      const sinLean = Math.sin(lean)
      // Spin around the vertical axis, then lean toward the viewer. Depth is
      // positive toward the viewer; the orbit ring skips the spin.
      const project = ([x, y, z]: Point, spinning: boolean) => {
        const spunX = spinning ? x * cosYaw + z * sinYaw : x
        const spunZ = spinning ? -x * sinYaw + z * cosYaw : z
        return {
          x: centerX + spunX * radius,
          y: centerY - (y * cosLean - spunZ * sinLean) * radius,
          depth: y * sinLean + spunZ * cosLean,
        }
      }
      // Each circle is stroked in runs of equal facing, so the far side stays faint.
      const stroke = (
        points: Point[],
        spinning: boolean,
        color: string,
        frontAlpha: number,
        backAlpha: number
      ) => {
        let front: boolean | null = null
        for (const point of points) {
          const screen = project(point, spinning)
          const facing = screen.depth >= 0
          if (facing !== front) {
            if (front !== null) context.stroke()
            context.beginPath()
            context.globalAlpha = facing ? frontAlpha : backAlpha
            context.strokeStyle = color
            front = facing
          }
          context.lineTo(screen.x, screen.y)
        }
        context.stroke()
      }

      // Log lines fade under the navigation and the hero copy so they never
      // sit on other text.
      const copyRect = content.getBoundingClientRect()
      const copyLeft = copyRect.left - heroRect.left - 12
      const copyRight = copyRect.right - heroRect.left + 12
      const copyTop = copyRect.top - heroRect.top - 12
      const copyBottom = copyRect.bottom - heroRect.top + 12
      const seconds = now / 1000
      const drawLogLines = (front: boolean) => {
        context.textAlign = 'center'
        context.textBaseline = 'middle'
        context.fillStyle = '#dbe7f5'
        for (const rider of LOG_RIDERS) {
          const angle = (seconds * rider.ring.speed + rider.phase) * Math.PI * 2
          const screen = project(ringPoint(rider.ring, angle), false)
          if (screen.depth >= 0 !== front) continue
          const near = Math.min(1, Math.max(0, (screen.depth + 1.6) / 3.2))
          const overCopy =
            screen.y < top + 8 ||
            (screen.x > copyLeft &&
              screen.x < copyRight &&
              screen.y > copyTop &&
              screen.y < copyBottom)
          context.globalAlpha =
            (front ? 0.5 + near * 0.4 : 0.2) * (overCopy ? 0.2 : 1)
          const font = `${(10.5 + near * 2.5).toFixed(1)}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`
          if (font !== lastFont) {
            lastFont = font
            context.font = font
          }
          context.fillText(rider.text, screen.x, screen.y)
        }
      }

      context.setTransform(dpr, 0, 0, dpr, 0, 0)
      context.clearRect(0, 0, width, height)
      context.lineWidth = 1
      context.lineCap = 'round'
      // A soft dark halo around the globe gives the rings and log lines a
      // calmer field than a bright random wallpaper offers on its own.
      const haloKey = `${centerX}/${centerY}/${radius}`
      if (halo?.key !== haloKey) {
        const gradient = context.createRadialGradient(
          centerX,
          centerY,
          radius * 0.9,
          centerX,
          centerY,
          radius * 2
        )
        gradient.addColorStop(0, 'rgb(6 12 22 / 42%)')
        gradient.addColorStop(0.55, 'rgb(6 12 22 / 20%)')
        gradient.addColorStop(1, 'rgb(6 12 22 / 0%)')
        halo = { key: haloKey, gradient }
      }
      context.globalAlpha = 1
      context.fillStyle = halo.gradient
      // The gradient is transparent beyond twice the radius; painting only
      // its box saves filling the whole hero every frame.
      context.fillRect(
        centerX - radius * 2,
        centerY - radius * 2,
        radius * 4,
        radius * 4
      )
      drawLogLines(false)
      const shadeKey = haloKey
      if (shade?.key !== shadeKey) {
        const gradient = context.createRadialGradient(
          centerX,
          centerY,
          radius * 0.2,
          centerX,
          centerY,
          radius
        )
        gradient.addColorStop(0, 'rgb(8 16 28 / 52%)')
        gradient.addColorStop(0.82, 'rgb(14 26 42 / 36%)')
        gradient.addColorStop(1, 'rgb(120 170 230 / 16%)')
        shade = { key: shadeKey, gradient }
      }
      context.globalAlpha = 1
      context.fillStyle = shade.gradient
      context.beginPath()
      context.arc(centerX, centerY, radius, 0, Math.PI * 2)
      context.fill()

      stroke(ORBIT_PATH, false, 'rgb(190 225 255)', 0, 0.14)
      // Dots are grouped by depth and filled once per group. One fill per dot
      // costs ~500 canvas calls per frame, which stutters on Windows' canvas.
      const front = dotAlphas.map(() => [] as number[])
      const back: number[] = []
      for (const point of SURFACE) {
        const screen = project(point, true)
        if (screen.depth < 0) {
          back.push(screen.x, screen.y)
          continue
        }
        const bucket = Math.min(
          front.length - 1,
          Math.floor(((screen.depth + 1) / 2) * front.length)
        )
        front[bucket].push(screen.x, screen.y)
      }
      if (back.length > 0) {
        context.globalAlpha = 0.12
        context.fillStyle = '#9fb8d4'
        context.beginPath()
        for (let index = 0; index < back.length; index += 2) {
          context.moveTo(back[index] + 1, back[index + 1])
          context.arc(back[index], back[index + 1], 1, 0, Math.PI * 2)
        }
        context.fill()
      }
      context.fillStyle = '#eaf4ff'
      front.forEach((dots, index) => {
        if (dots.length === 0) return
        context.globalAlpha = dotAlphas[index]
        context.beginPath()
        for (let cursor = 0; cursor < dots.length; cursor += 2) {
          context.moveTo(dots[cursor] + 1.3, dots[cursor + 1])
          context.arc(dots[cursor], dots[cursor + 1], 1.3, 0, Math.PI * 2)
        }
        context.fill()
      })
      context.globalAlpha = 1
      context.lineWidth = 1.1
      for (const ring of GRID) stroke(ring, true, '#ffffff', 0.34, 0.08)

      // Glows are layered strokes and gradients: canvas shadowBlur re-filters
      // the whole surface every frame and makes the animation stutter.
      context.beginPath()
      context.arc(centerX, centerY, radius, 0, Math.PI * 2)
      context.globalAlpha = 0.18
      context.strokeStyle = 'rgb(170 215 255)'
      context.lineWidth = 7
      context.stroke()
      context.globalAlpha = 0.86
      context.strokeStyle = '#dcefff'
      context.lineWidth = 1.2
      context.stroke()
      context.lineWidth = 1

      stroke(ORBIT_PATH, false, 'rgb(190 225 255)', 0.5, 0)
      for (let bead = 0; bead < BEADS; bead++) {
        const angle = (seconds * ORBIT.speed + bead / BEADS) * Math.PI * 2
        const screen = project(ringPoint(ORBIT, angle), false)
        if (screen.depth < 0) continue
        const glow = context.createRadialGradient(
          screen.x,
          screen.y,
          0,
          screen.x,
          screen.y,
          12
        )
        glow.addColorStop(0, 'rgb(244 251 255 / 95%)')
        glow.addColorStop(0.25, 'rgb(190 225 255 / 55%)')
        glow.addColorStop(1, 'rgb(190 225 255 / 0%)')
        context.globalAlpha = 1
        context.fillStyle = glow
        context.beginPath()
        context.arc(screen.x, screen.y, 12, 0, Math.PI * 2)
        context.fill()
      }
      drawLogLines(true)
      context.globalAlpha = 1
      if (visible && !document.hidden && !motion.matches) {
        frame = requestAnimationFrame(draw)
      }
    }
    const schedule = () => {
      cancelAnimationFrame(frame)
      frame = 0
      last = null
      if (visible && !document.hidden) frame = requestAnimationFrame(draw)
    }
    const pointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return
      drag = { x: event.clientX, y: event.clientY, yaw, pitch }
      canvas.setPointerCapture(event.pointerId)
      canvas.dataset.dragging = 'true'
      schedule()
    }
    const pointerMove = (event: PointerEvent) => {
      if (!drag) return
      yaw = drag.yaw + (event.clientX - drag.x) * 0.005
      pitch = Math.min(
        0.6,
        Math.max(-0.6, drag.pitch + (event.clientY - drag.y) * 0.004)
      )
      if (motion.matches) schedule()
    }
    const pointerUp = () => {
      drag = null
      delete canvas.dataset.dragging
      schedule()
    }
    const intersection = new IntersectionObserver(([entry]) => {
      visible = entry?.isIntersecting ?? true
      schedule()
    })
    intersection.observe(hero)
    const resize = new ResizeObserver(schedule)
    resize.observe(hero)
    resize.observe(content)
    canvas.addEventListener('pointerdown', pointerDown)
    canvas.addEventListener('pointermove', pointerMove)
    canvas.addEventListener('pointerup', pointerUp)
    canvas.addEventListener('pointercancel', pointerUp)
    document.addEventListener('visibilitychange', schedule)
    motion.addEventListener('change', schedule)
    schedule()
    return () => {
      cancelAnimationFrame(frame)
      intersection.disconnect()
      resize.disconnect()
      canvas.removeEventListener('pointerdown', pointerDown)
      canvas.removeEventListener('pointermove', pointerMove)
      canvas.removeEventListener('pointerup', pointerUp)
      canvas.removeEventListener('pointercancel', pointerUp)
      document.removeEventListener('visibilitychange', schedule)
      motion.removeEventListener('change', schedule)
    }
  }, [canvasRef])
}
