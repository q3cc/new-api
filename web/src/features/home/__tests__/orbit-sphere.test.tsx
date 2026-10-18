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
import { act, fireEvent, render } from '@testing-library/react'
import { useRef } from 'react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { ORBIT_LOG_LINES, useOrbitSphere } from '../hooks/use-orbit-sphere'

let frames: Map<number, FrameRequestCallback>
let nextFrame: number
let reducedMotion: boolean
let context: Record<string, ReturnType<typeof vi.fn>>
let textAlphas: number[]

function Fixture() {
  const ref = useRef<HTMLCanvasElement>(null)
  useOrbitSphere(ref)
  return (
    <>
      <header>
        <nav />
      </header>
      <section className='home-hero'>
        <canvas ref={ref} className='home-orbit' aria-hidden='true' />
        <div className='home-hero-content'>
          <p>Eyebrow</p>
          <div className='home-title-stage'>
            <h1 className='home-title'>Title</h1>
          </div>
        </div>
        <dl className='home-metrics' />
      </section>
    </>
  )
}
function step(time: number) {
  const pending = [...frames.values()]
  frames.clear()
  act(() => pending.forEach((callback) => callback(time)))
}
/** Screen positions of the stroked wireframe in the frames drawn so far. */
function wireframe() {
  return context.lineTo.mock.calls
    .map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`)
    .join(' ')
}

beforeEach(() => {
  frames = new Map()
  nextFrame = 0
  reducedMotion = false
  textAlphas = []
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
    frames.set(++nextFrame, callback)
    return nextFrame
  })
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => {
    frames.delete(id)
  })
  vi.spyOn(window, 'matchMedia').mockImplementation((query) => {
    const entry = new EventTarget() as MediaQueryList
    Object.defineProperty(entry, 'matches', {
      configurable: true,
      get: () => query.includes('reduced-motion') && reducedMotion,
    })
    return entry
  })
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      observe() {}
      disconnect() {}
    }
  )
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    }
  )
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
    function (this: HTMLElement) {
      if (this.classList.contains('home-hero')) {
        return new DOMRect(0, 0, 1200, 800)
      }
      if (this.tagName === 'HEADER') {
        return new DOMRect(0, 0, 1200, 100)
      }
      if (this.classList.contains('home-metrics')) {
        return new DOMRect(0, 660, 1200, 120)
      }
      if (this.classList.contains('home-title-stage')) {
        return new DOMRect(400, 320, 400, 60)
      }
      if (this.classList.contains('home-hero-content')) {
        return new DOMRect(300, 200, 600, 400)
      }
      return new DOMRect(0, 0, 0, 0)
    }
  )
  context = Object.fromEntries(
    [
      'setTransform',
      'clearRect',
      'fillRect',
      'beginPath',
      'arc',
      'fill',
      'stroke',
      'lineTo',
      'moveTo',
      'addColorStop',
    ].map((name) => [name, vi.fn()])
  )
  // Record the alpha each log line is painted with.
  context.fillText = vi.fn(function (this: { globalAlpha: number }) {
    textAlphas.push(this.globalAlpha)
  })
  context.createRadialGradient = vi.fn(() => ({
    addColorStop: context.addColorStop,
  }))
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
    context as unknown as CanvasRenderingContext2D
  )
  HTMLElement.prototype.setPointerCapture = vi.fn()
})
afterEach(() => {
  vi.unstubAllGlobals()
})

test('the globe is centred on the title and kept clear of the navigation', () => {
  render(<Fixture />)
  step(0)
  // The limb ring sits on the title's centre (not the copy block's, which is
  // 50px lower) and stops 14px short of the navigation (bottom 100) rather
  // than filling 34% of the hero height (272).
  expect(context.arc).toHaveBeenCalledWith(600, 350, 236, 0, Math.PI * 2)
  expect(context.lineTo).toHaveBeenCalled()
  expect(frames.size).toBe(1)
})

test('the globe keeps spinning between frames and a drag turns it by hand', () => {
  const { container } = render(<Fixture />)
  step(0)
  const still = wireframe()
  context.lineTo.mockClear()
  step(1000)
  const spun = wireframe()
  expect(spun).not.toBe(still)
  const canvas = container.querySelector('canvas')
  if (!canvas) throw new Error('Missing canvas')
  fireEvent.pointerDown(canvas, {
    button: 0,
    clientX: 100,
    clientY: 100,
    pointerId: 1,
  })
  expect(canvas).toHaveAttribute('data-dragging', 'true')
  fireEvent.pointerMove(canvas, { clientX: 220, clientY: 100, pointerId: 1 })
  context.lineTo.mockClear()
  step(1016)
  const dragged = wireframe()
  expect(dragged).not.toBe(spun)
  fireEvent.pointerUp(canvas, { pointerId: 1 })
  expect(canvas).not.toHaveAttribute('data-dragging')
})

test('reduced motion draws one still frame and stops scheduling', () => {
  reducedMotion = true
  const { unmount } = render(<Fixture />)
  step(0)
  expect(context.arc).toHaveBeenCalled()
  expect(frames.size).toBe(0)
  unmount()
  expect(frames.size).toBe(0)
})

test('API log lines orbit the globe, dim on its far side and keep moving', () => {
  render(<Fixture />)
  step(0)
  expect(context.fillText).toHaveBeenCalledTimes(ORBIT_LOG_LINES.length)
  const texts = context.fillText.mock.calls.map(([text]) => text)
  expect(new Set(texts)).toEqual(new Set(ORBIT_LOG_LINES))
  expect(textAlphas.some((alpha) => alpha <= 0.2)).toBe(true)
  expect(textAlphas.some((alpha) => alpha >= 0.5)).toBe(true)
  const first = context.fillText.mock.calls.map(([, x, y]) => `${x},${y}`)
  context.fillText.mockClear()
  step(1000)
  const later = context.fillText.mock.calls.map(([, x, y]) => `${x},${y}`)
  expect(later).not.toEqual(first)
})

test('the surface dots are filled in a few batched paths rather than one per dot', () => {
  render(<Fixture />)
  step(0)
  // Hundreds of dots still land in the drawing, but each depth bucket is a
  // single fill. Per-dot fills are what stutters on Windows' canvas.
  expect(context.arc.mock.calls.length).toBeGreaterThan(300)
  expect(context.fill.mock.calls.length).toBeLessThanOrEqual(10)
})
