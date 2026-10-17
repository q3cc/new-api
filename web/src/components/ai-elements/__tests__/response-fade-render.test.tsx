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
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'

import { Response } from '../response'
import {
  FADE_DURATION_MS,
  FADE_HYDRATION_THRESHOLD,
  FADE_STAGGER_MAX_MS,
} from '../response-fade'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('Response streaming fade', () => {
  test.each([
    ['paragraph', '你好', '你好，世界'],
    ['heading', '## Hello', '## Hello world'],
    ['list', '- Hello', '- Hello world'],
    ['strong', '**Hello**', '**Hello world**'],
  ])(
    'keeps the running %s fade mounted when a stream appends text',
    (_, first, next) => {
      vi.spyOn(performance, 'now').mockReturnValue(1000)
      const { container, rerender } = render(
        <Response final={false}>{first}</Response>
      )
      const animated = container.querySelector('[data-stream-fade]')
      expect(animated).not.toBeNull()

      vi.spyOn(performance, 'now').mockReturnValue(1050)
      rerender(<Response final={false}>{next}</Response>)

      // Replacing the span restarts its CSS animation at opacity zero on every
      // token, making already visible text blink or disappear during streaming.
      expect(container.querySelector('[data-stream-fade]')).toBe(animated)
    }
  )

  test('wraps newly streamed words when final is false', () => {
    const { rerender } = render(<Response final={false}>Hello</Response>)

    expect(
      document.querySelectorAll('[data-stream-fade]').length
    ).toBeGreaterThan(0)
    expect(screen.getByText('Hello')).toBeTruthy()

    rerender(<Response final={false}>Hello world</Response>)

    const fades = [...document.querySelectorAll('[data-stream-fade]')]
    expect(fades.some((node) => node.textContent === 'world')).toBe(true)
  })

  test('renders settled content with zero fade wrappers when final is true', () => {
    render(<Response final>Hello world</Response>)

    expect(document.querySelectorAll('[data-stream-fade]')).toHaveLength(0)
    expect(screen.getByText(/Hello world/)).toBeTruthy()
  })

  test('does not fade inline code or fenced code blocks', () => {
    render(
      <Response final={false}>
        {['Use `code` and:', '', '```', 'block', '```'].join('\n')}
      </Response>
    )

    const fades = [...document.querySelectorAll('[data-stream-fade]')]
    const fadedText = fades.map((node) => node.textContent ?? '').join('')
    expect(fadedText.includes('block')).toBe(false)
    expect(
      fades.every((node) => {
        const text = node.textContent ?? ''
        return text.trim() !== 'code' && text.trim() !== 'block'
      })
    ).toBe(true)
  })

  test('does not re-animate words after markdown restructuring around strong', () => {
    vi.spyOn(performance, 'now').mockReturnValue(1000)
    const { rerender } = render(<Response final={false}>**fin</Response>)
    expect(
      document.querySelectorAll('[data-stream-fade]').length
    ).toBeGreaterThan(0)

    vi.spyOn(performance, 'now').mockReturnValue(
      1000 + FADE_DURATION_MS + FADE_STAGGER_MAX_MS + 1
    )
    rerender(<Response final={false}>**final**</Response>)

    const strong = document.querySelector('strong')
    expect(strong?.textContent).toContain('final')

    const fades = [...document.querySelectorAll('[data-stream-fade]')]
    expect(
      fades.every((node) => !(node.textContent ?? '').includes('final'))
    ).toBe(true)
  })

  test('suppresses fades on the first streaming render of hydrated content', () => {
    const hydrated = 'word '.repeat(FADE_HYDRATION_THRESHOLD)

    render(<Response final={false}>{hydrated}</Response>)

    expect(document.querySelectorAll('[data-stream-fade]')).toHaveLength(0)
  })

  test('drops all fade wrappers once the stream settles', () => {
    const { rerender } = render(
      <Response final={false}>Streaming text</Response>
    )
    expect(
      document.querySelectorAll('[data-stream-fade]').length
    ).toBeGreaterThan(0)

    rerender(<Response final>Streaming text</Response>)
    expect(document.querySelectorAll('[data-stream-fade]')).toHaveLength(0)
  })

  test('keeps Chinese, emoji and Markdown text intact across streamed updates and completion', () => {
    const chunks = [
      '## 雾港\n\n',
      '我把右耳贴近门缝。',
      '**蓝色火光**仍在摇晃。👩🏽‍💻\n\n',
      '- 线索：`第47页`\n',
      '- [继续阅读](https://example.com/story)',
    ]
    const { container, rerender } = render(<Response final={false} />)
    let content = ''
    for (const chunk of chunks) {
      content += chunk
      rerender(<Response final={false}>{content}</Response>)
    }
    const streamedText = container.textContent

    rerender(<Response final>{content}</Response>)

    expect(container.textContent).toBe(streamedText)
    expect(screen.getByRole('heading', { name: '雾港' })).toBeTruthy()
    expect(container.textContent).toContain(
      '我把右耳贴近门缝。蓝色火光仍在摇晃。👩🏽‍💻'
    )
    expect(
      screen.getByRole('link', { name: '继续阅读' }).getAttribute('href')
    ).toBe('https://example.com/story')
    expect(container.querySelectorAll('[data-stream-fade]')).toHaveLength(0)
  })
})
