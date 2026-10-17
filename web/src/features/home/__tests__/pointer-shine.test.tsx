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
import { render } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { usePointerShine } from '../hooks/use-pointer-shine'

const originalMatchMedia = window.matchMedia

function setMatchMedia(value: typeof window.matchMedia) {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value,
  })
}

function stubMediaQueries(matches: (query: string) => boolean) {
  setMatchMedia(
    vi.fn((query: string) => ({
      matches: matches(query),
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })) as unknown as typeof window.matchMedia
  )
}

function ShinyTitle() {
  const ref = usePointerShine<HTMLHeadingElement>()
  return <h1 ref={ref}>New API</h1>
}

function stubBox(element: HTMLElement) {
  element.getBoundingClientRect = () =>
    ({ left: 0, top: 0, width: 200, height: 100 }) as DOMRect
}

function moveMouse(element: HTMLElement, clientX: number, clientY: number) {
  element.dispatchEvent(
    new PointerEvent('pointermove', {
      bubbles: true,
      clientX,
      clientY,
      pointerType: 'mouse',
    })
  )
}

beforeEach(() => {
  stubMediaQueries((query) => query === '(hover: hover) and (pointer: fine)')
})

afterEach(() => {
  setMatchMedia(originalMatchMedia)
})

test('moves the specular highlight to the mouse position', () => {
  const { getByRole } = render(<ShinyTitle />)
  const title = getByRole('heading')
  stubBox(title)

  moveMouse(title, 150, 25)

  expect(title.style.getPropertyValue('--shine-x')).toBe('75%')
  expect(title.style.getPropertyValue('--shine-y')).toBe('25%')
})

test('aligns the reflection band with the pointer direction', () => {
  const { getByRole } = render(<ShinyTitle />)
  const title = getByRole('heading')
  stubBox(title)

  moveMouse(title, 100, 10)

  expect(title.style.getPropertyValue('--shine-angle')).toBe('0.0deg')
})

test('restores the static highlight when the mouse leaves the title', () => {
  const { getByRole } = render(<ShinyTitle />)
  const title = getByRole('heading')
  stubBox(title)
  moveMouse(title, 150, 25)

  title.dispatchEvent(
    new PointerEvent('pointerleave', { pointerType: 'mouse' })
  )

  expect(title.style.getPropertyValue('--shine-x')).toBe('50%')
  expect(title.style.getPropertyValue('--shine-y')).toBe('34%')
  expect(title.style.getPropertyValue('--shine-angle')).toBe('145deg')
})

test('clamps the highlight when the pointer sits outside the text box', () => {
  const { getByRole } = render(<ShinyTitle />)
  const title = getByRole('heading')
  stubBox(title)

  moveMouse(title, -40, 160)

  expect(title.style.getPropertyValue('--shine-x')).toBe('0%')
  expect(title.style.getPropertyValue('--shine-y')).toBe('100%')
})

test('ignores touch pointers even on a hover-capable device', () => {
  const { getByRole } = render(<ShinyTitle />)
  const title = getByRole('heading')
  stubBox(title)

  title.dispatchEvent(
    new PointerEvent('pointermove', {
      bubbles: true,
      clientX: 150,
      clientY: 25,
      pointerType: 'touch',
    })
  )

  expect(title.style.getPropertyValue('--shine-x')).toBe('')
})

test('keeps the static highlight on coarse-pointer devices', () => {
  stubMediaQueries(() => false)
  const { getByRole } = render(<ShinyTitle />)
  const title = getByRole('heading')
  stubBox(title)

  moveMouse(title, 150, 25)

  expect(title.style.getPropertyValue('--shine-x')).toBe('')
})

test('keeps the static highlight when reduced motion is requested', () => {
  stubMediaQueries(
    (query) =>
      query === '(hover: hover) and (pointer: fine)' ||
      query === '(prefers-reduced-motion: reduce)'
  )
  const { getByRole } = render(<ShinyTitle />)
  const title = getByRole('heading')
  stubBox(title)

  moveMouse(title, 150, 25)

  expect(title.style.getPropertyValue('--shine-x')).toBe('')
})

function GlassLinks() {
  const ref = usePointerShine<HTMLDivElement>('[data-glass]')
  return (
    <div ref={ref}>
      <a href='/pricing' data-glass>
        <span>Models</span>
      </a>
      <a href='/dashboard' data-glass>
        Dashboard
      </a>
    </div>
  )
}

test('delegated glass highlights use each surface box, including nested content', () => {
  const { getByRole, getByText } = render(<GlassLinks />)
  const models = getByRole('link', { name: 'Models' })
  const dashboard = getByRole('link', { name: 'Dashboard' })
  stubBox(models)
  stubBox(dashboard)
  moveMouse(getByText('Models'), 150, 25)
  expect(models.style.getPropertyValue('--shine-x')).toBe('75%')
  moveMouse(dashboard, 50, 75)
  expect(models.style.getPropertyValue('--shine-x')).toBe('50%')
  expect(dashboard.style.getPropertyValue('--shine-x')).toBe('25%')
  expect(models).toHaveAttribute('href', '/pricing')
})

test('leaving a glass surface resets its highlight without leaving the page', () => {
  const { getByRole } = render(<GlassLinks />)
  const models = getByRole('link', { name: 'Models' })
  stubBox(models)
  moveMouse(models, 150, 25)
  models.dispatchEvent(new PointerEvent('pointerout', { bubbles: true }))
  expect(models.style.getPropertyValue('--shine-x')).toBe('50%')
})

test('enabling reduced motion while mounted immediately restores static light', () => {
  const motion = new EventTarget() as MediaQueryList
  Object.defineProperty(motion, 'matches', { configurable: true, value: false })
  const previous = window.matchMedia
  setMatchMedia(
    vi.fn((query: string) =>
      query.includes('reduced-motion') ? motion : previous(query)
    )
  )
  const { getByRole } = render(<ShinyTitle />)
  const title = getByRole('heading')
  stubBox(title)
  moveMouse(title, 150, 25)
  Object.defineProperty(motion, 'matches', { value: true })
  motion.dispatchEvent(new Event('change'))
  expect(title.style.getPropertyValue('--shine-x')).toBe('50%')
  moveMouse(title, 10, 10)
  expect(title.style.getPropertyValue('--shine-x')).toBe('50%')
})
