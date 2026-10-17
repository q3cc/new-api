import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
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
import { useRef } from 'react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { api } from '@/lib/http-client'

import { HOME_WALLPAPER_URL, useWebglGlass } from '../hooks/use-webgl-glass'
import {
  coverImageRect,
  createGlassRenderer,
  GLASS_MATERIALS,
  PRIMARY_TINT,
} from '../lib/glass-renderer'

let image: HTMLImageElement
let heroTop: number
let textTop: number
let frames: Map<number, FrameRequestCallback>
let nextFrame: number
let media: Map<string, MediaQueryList>

function glBoundary() {
  const context = {
    VERTEX_SHADER: 1,
    FRAGMENT_SHADER: 2,
    COMPILE_STATUS: 3,
    LINK_STATUS: 4,
    getExtension: vi.fn(() => null),
    createProgram: vi.fn(() => ({})),
    createShader: vi.fn(() => ({})),
    createBuffer: vi.fn(() => ({})),
    createTexture: vi.fn(() => ({})),
    getShaderParameter: vi.fn(() => true),
    getProgramParameter: vi.fn(() => true),
    getShaderInfoLog: vi.fn(() => 'Unsupported shader'),
    getAttribLocation: vi.fn(() => 0),
    getUniformLocation: vi.fn(() => ({})),
    shaderSource: vi.fn(),
    compileShader: vi.fn(),
    attachShader: vi.fn(),
    linkProgram: vi.fn(),
    useProgram: vi.fn(),
    bindBuffer: vi.fn(),
    bufferData: vi.fn(),
    enableVertexAttribArray: vi.fn(),
    vertexAttribPointer: vi.fn(),
    bindTexture: vi.fn(),
    texParameteri: vi.fn(),
    texImage2D: vi.fn(),
    uniform1i: vi.fn(),
    uniform1f: vi.fn(),
    uniform2f: vi.fn(),
    uniform4f: vi.fn(),
    viewport: vi.fn(),
    clear: vi.fn(),
    drawArrays: vi.fn(),
    deleteShader: vi.fn(),
    deleteProgram: vi.fn(),
    deleteTexture: vi.fn(),
    deleteBuffer: vi.fn(),
  }
  return context
}
let gl: ReturnType<typeof glBoundary>
function Fixture() {
  const ref = useRef<HTMLDivElement>(null)
  useWebglGlass(ref)
  return (
    <div ref={ref}>
      <div className='home-backdrop' style={{ backgroundPositionX: '50%' }} />
      <header data-scrolled=''>
        <nav style={{ borderTopLeftRadius: 18 }}>
          <a href='/pricing'>Models</a>
        </nav>
      </header>
      <section className='home-hero'>
        <div className='home-hero-content'>
          <h1>Title</h1>
          <div className='home-hero-actions'>
            <a
              data-slot='button'
              className='home-primary'
              href='/sign-up'
              style={{ borderTopLeftRadius: 999 }}
            >
              Get Started
            </a>
            <a
              data-slot='button'
              className='home-secondary'
              href='/pricing'
              style={{ borderTopLeftRadius: 999 }}
            >
              Explore
            </a>
          </div>
        </div>
        <dl className='home-metrics' style={{ borderTopLeftRadius: 24 }}>
          <dt>Models</dt>
          <dd>21</dd>
        </dl>
      </section>
    </div>
  )
}
function step() {
  const pending = [...frames.values()]
  frames.clear()
  act(() => pending.forEach((callback) => callback(16)))
}
function load() {
  act(() => image.dispatchEvent(new Event('load')))
  step()
}
function setMedia(query: string, matches: boolean) {
  const entry = media.get(query)
  if (!entry) throw new Error('Missing media query')
  Object.defineProperty(entry, 'matches', {
    configurable: true,
    value: matches,
  })
  act(() => entry.dispatchEvent(new Event('change')))
  step()
}

beforeEach(() => {
  heroTop = 0
  textTop = 200
  frames = new Map()
  nextFrame = 0
  media = new Map()
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
      value: false,
    })
    media.set(query, entry)
    return entry
  })
  vi.stubGlobal(
    'Image',
    class extends EventTarget {
      naturalWidth = 1600
      naturalHeight = 900
      src = ''
      constructor() {
        super()
        image = this as unknown as HTMLImageElement
      }
    }
  )
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
    function (this: HTMLElement) {
      if (this.classList.contains('home-hero')) {
        return new DOMRect(0, heroTop, 1200, 800)
      }
      if (this.classList.contains('home-backdrop')) {
        return new DOMRect(0, 0, 1200, 800)
      }
      if (this.tagName === 'H1') return new DOMRect(20, textTop, 600, 60)
      if (this.matches('[data-slot=button]')) {
        return new DOMRect(300, 400, 140, 48)
      }
      if (this.classList.contains('home-hero-actions')) {
        return new DOMRect(300, 400, 300, 48)
      }
      if (
        this.classList.contains('home-metrics') ||
        this.parentElement?.classList.contains('home-metrics')
      ) {
        return new DOMRect(20, 600, 600, 60)
      }
      return new DOMRect(20, 20, 600, 60)
    }
  )
  gl = glBoundary()
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
    gl as unknown as WebGLRenderingContext
  )
  // The wallpaper request stays pending unless a test resolves it.
  vi.spyOn(api, 'get').mockReturnValue(new Promise(() => {}))
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    value: vi.fn(() => 'blob:wallpaper'),
  })
  Object.defineProperty(URL, 'revokeObjectURL', {
    configurable: true,
    value: vi.fn(),
  })
})
afterEach(() => {
  vi.unstubAllGlobals()
  delete (URL as { createObjectURL?: unknown }).createObjectURL
  delete (URL as { revokeObjectURL?: unknown }).revokeObjectURL
})

test('cover sampling preserves center crop and mobile 62-percent background position', () => {
  expect(
    coverImageRect(
      { width: 1600, height: 900 },
      { x: -20, y: -10, width: 1200, height: 900 },
      0.5
    )
  ).toEqual({ x: -220, y: -10, width: 1600, height: 900 })
  const mobile = coverImageRect(
    { width: 1600, height: 900 },
    { x: 0, y: 0, width: 390, height: 900 },
    0.62
  )
  expect(mobile.x).toBeCloseTo(-750.2)
  expect(mobile.width).toBe(1600)
})

test('loaded wallpaper enables decorative WebGL without replacing the native link', () => {
  const { unmount, container } = render(<Fixture />)
  load()
  expect(screen.getByRole('link', { name: 'Models' })).toHaveAttribute(
    'href',
    '/pricing'
  )
  const canvases = [...container.querySelectorAll('canvas')]
  expect(canvases).toHaveLength(4)
  canvases.forEach((canvas) => {
    expect(canvas).toHaveAttribute('aria-hidden', 'true')
    expect(canvas.parentElement).toHaveAttribute('data-glass-renderer', 'webgl')
  })
  expect(frames.size).toBe(1)
  unmount()
  expect(frames.size).toBe(0)
  expect(gl.deleteTexture).toHaveBeenCalledTimes(4)
  expect(gl.deleteProgram).toHaveBeenCalledTimes(4)
})

test('each surface is drawn with its own optical recipe and the primary action carries the accent tint', () => {
  const uniform4f = gl.uniform4f
  const lens = (material: { refractionHeight: number }) =>
    uniform4f.mock.calls.filter(
      ([, height]) => height === material.refractionHeight
    )
  render(<Fixture />)
  load()
  // Navigation (bar) and buttons share the shallow 12px lens, the metrics
  // card uses the deep 24px lens with dispersion in its corners.
  expect(lens(GLASS_MATERIALS.card)).toHaveLength(1)
  expect(lens(GLASS_MATERIALS.bar)).toHaveLength(3)
  const [cardLens] = lens(GLASS_MATERIALS.card)
  expect(cardLens.slice(2)).toEqual([
    GLASS_MATERIALS.card.refractionAmount,
    GLASS_MATERIALS.card.dispersion,
    1,
  ])
  const tints = uniform4f.mock.calls.filter(
    ([, r, g, b, a]) =>
      r === PRIMARY_TINT[0] &&
      g === PRIMARY_TINT[1] &&
      b === PRIMARY_TINT[2] &&
      a === PRIMARY_TINT[3]
  )
  expect(tints).toHaveLength(1)
})

test('the rim is lit from the upper right at rest and follows the pointer light angle', () => {
  const { container } = render(<Fixture />)
  load()
  const angles = () =>
    gl.uniform1f.mock.calls
      .map(([, value]) => value)
      .filter((value) => typeof value === 'number' && Math.abs(value) < 7)
  expect(angles()).toContain(-Math.PI / 4)
  const nav = container.querySelector<HTMLElement>('nav')
  if (!nav) throw new Error('Missing nav')
  gl.uniform1f.mockClear()
  nav.style.setProperty('--shine-angle', '180deg')
  step()
  expect(angles()).toContain(Math.PI / 2)
})

test('unsupported WebGL retains CSS material and native navigation', () => {
  vi.mocked(HTMLCanvasElement.prototype.getContext).mockReturnValue(null)
  const { container } = render(<Fixture />)
  load()
  expect(container.querySelector('[data-glass-renderer]')).toBeNull()
  expect(screen.getByRole('link', { name: 'Models' })).toHaveAttribute(
    'href',
    '/pricing'
  )
  expect(frames.size).toBe(0)
})

test('a shader compile failure releases allocations and retains CSS', () => {
  gl.getShaderParameter.mockReturnValue(false)
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  expect(
    createGlassRenderer(document.createElement('canvas'), image)
  ).toBeNull()
  expect(gl.deleteTexture).toHaveBeenCalledOnce()
  expect(gl.deleteProgram).toHaveBeenCalledOnce()
})

test('context loss restores CSS immediately and context restoration resumes WebGL', () => {
  const { container } = render(<Fixture />)
  load()
  const canvas = container.querySelector('canvas')
  if (!canvas) throw new Error('Missing glass canvas')
  fireEvent(canvas, new Event('webglcontextlost', { cancelable: true }))
  expect(canvas.parentElement).not.toHaveAttribute('data-glass-renderer')
  fireEvent(canvas, new Event('webglcontextrestored'))
  step()
  expect(canvas.parentElement).toHaveAttribute('data-glass-renderer', 'webgl')
})

test('reduced motion stops continuous rendering and reduced transparency restores CSS', () => {
  const { container } = render(<Fixture />)
  load()
  setMedia('(prefers-reduced-motion: reduce)', true)
  expect(frames.size).toBe(0)
  expect(container.querySelector('[data-glass-renderer=webgl]')).not.toBeNull()
  setMedia('(prefers-reduced-transparency: reduce)', true)
  expect(container.querySelector('[data-glass-renderer]')).toBeNull()
  setMedia('(prefers-reduced-transparency: reduce)', false)
  expect(container.querySelector('[data-glass-renderer=webgl]')).not.toBeNull()
})

test('scrolling beyond the hero pauses WebGL and restores DOM-backed blur on navigation', () => {
  const { container } = render(<Fixture />)
  load()
  heroTop = -900
  fireEvent.scroll(window)
  step()
  expect(container.querySelector('[data-glass-renderer]')).toBeNull()
  expect(frames.size).toBe(0)
  heroTop = 0
  fireEvent.scroll(window)
  step()
  expect(container.querySelector('[data-glass-renderer=webgl]')).not.toBeNull()
})

test('a hidden tab suspends rendering and resumes when visible', () => {
  render(<Fixture />)
  load()
  const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true)
  fireEvent(document, new Event('visibilitychange'))
  expect(frames.size).toBe(0)
  hidden.mockReturnValue(false)
  fireEvent(document, new Event('visibilitychange'))
  step()
  expect(frames.size).toBe(1)
})

test('a failed wallpaper load leaves native content and CSS glass available', () => {
  const { container } = render(<Fixture />)
  fireEvent(image, new Event('error'))
  expect(container.querySelector('canvas')).toBeNull()
  expect(screen.getByRole('link', { name: 'Models' })).toHaveAttribute(
    'href',
    '/pricing'
  )
  expect(frames.size).toBe(0)
})

test('the navigation stays clear at the top of the page and turns to glass once scrolled', () => {
  const { container } = render(<Fixture />)
  const header = container.querySelector('header')
  if (!header) throw new Error('Missing header')
  header.removeAttribute('data-scrolled')
  load()
  expect(container.querySelector('nav')).not.toHaveAttribute(
    'data-glass-renderer'
  )
  expect(container.querySelector('.home-metrics')).toHaveAttribute(
    'data-glass-renderer',
    'webgl'
  )
  header.setAttribute('data-scrolled', '')
  step()
  expect(container.querySelector('nav')).toHaveAttribute(
    'data-glass-renderer',
    'webgl'
  )
})

test('navigation uses DOM blur when scrolling text behind it instead of painting wallpaper over the text', () => {
  const { container } = render(<Fixture />)
  load()
  textTop = 20
  fireEvent.scroll(window)
  step()
  expect(container.querySelector('nav')).not.toHaveAttribute(
    'data-glass-renderer'
  )
  expect(container.querySelector('.home-metrics')).toHaveAttribute(
    'data-glass-renderer',
    'webgl'
  )
})

test('the random wallpaper comes through the same-origin proxy and one copy feeds the backdrop and the glass', async () => {
  const blob = new Blob(['webp'], { type: 'image/webp' })
  vi.mocked(api.get).mockResolvedValue({ data: blob })
  const { container, unmount } = render(<Fixture />)
  await act(async () => {})
  expect(api.get).toHaveBeenCalledWith(
    HOME_WALLPAPER_URL,
    expect.objectContaining({ responseType: 'blob', skipErrorHandler: true })
  )
  expect(URL.createObjectURL).toHaveBeenCalledWith(blob)
  expect(image.src).toBe('blob:wallpaper')
  const backdrop = container.querySelector<HTMLElement>('.home-backdrop')
  expect(backdrop).not.toHaveAttribute('data-wallpaper')
  load()
  expect(backdrop?.style.backgroundImage).toBe('url("blob:wallpaper")')
  expect(backdrop).toHaveAttribute('data-wallpaper', 'ready')
  expect(container.querySelectorAll('canvas')).toHaveLength(4)
  unmount()
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:wallpaper')
})

test('a failed wallpaper request falls back to the bundled picture and a non-image answer is refused', async () => {
  vi.mocked(api.get).mockRejectedValueOnce(new Error('offline'))
  render(<Fixture />)
  await act(async () => {})
  expect(image.src).toMatch(/home-observatory/)
  expect(URL.createObjectURL).not.toHaveBeenCalled()
  cleanup()
  vi.mocked(api.get).mockResolvedValueOnce({
    data: new Blob(['<html></html>'], { type: 'text/html' }),
  })
  render(<Fixture />)
  await act(async () => {})
  expect(image.src).toMatch(/home-observatory/)
  expect(URL.createObjectURL).not.toHaveBeenCalled()
})
