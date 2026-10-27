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
import { parseMarkdownToStructure } from 'stream-markdown-parser'
import { afterEach, describe, expect, test, vi } from 'vitest'

import { Response } from '../response'

// The parser is wrapped so each call's instance and options can be checked.
vi.mock('stream-markdown-parser', async (importOriginal) => {
  const actual = await importOriginal<typeof import('stream-markdown-parser')>()
  return {
    ...actual,
    parseMarkdownToStructure: vi.fn(actual.parseMarkdownToStructure),
  }
})
const parse = vi.mocked(parseMarkdownToStructure)

afterEach(() => {
  cleanup()
  parse.mockClear()
})

describe('Response incremental parsing', () => {
  test('keeps Markdown for a long streaming reply instead of falling back to text', () => {
    const long = `## Still a heading\n\n${'word '.repeat(8000)}`
    render(<Response final={false}>{long}</Response>)
    expect(
      screen.getByRole('heading', { name: 'Still a heading' })
    ).toBeTruthy()
    // Fading every word of a reply this long costs more than it shows.
    expect(document.querySelectorAll('[data-stream-fade]')).toHaveLength(0)
  })

  test('reuses the stable top-level nodes of the same message between appends', () => {
    const { rerender } = render(
      <Response final={false} parserId='message-a'>
        {'# Title\n\nFirst paragraph.'}
      </Response>
    )
    rerender(
      <Response final={false} parserId='message-a'>
        {'# Title\n\nFirst paragraph.\n\nSecond paragraph.'}
      </Response>
    )
    expect(parse).toHaveBeenCalledTimes(2)
    const [, firstInstance, firstOptions] = parse.mock.calls[0]
    const [, secondInstance, secondOptions] = parse.mock.calls[1]
    expect(secondInstance).toBe(firstInstance)
    expect(firstOptions?.reuseStableTopLevelNodes).toBe(true)
    expect(secondOptions?.reuseStableTopLevelNodes).toBe(true)
    expect(
      secondOptions?.parserMetrics?.processTokensReusedTopLevelNodes
    ).toBeGreaterThan(0)

    rerender(
      <Response final parserId='message-a'>
        {'# Title\n\nFirst paragraph.\n\nSecond paragraph.'}
      </Response>
    )
    const [, , finalOptions] = parse.mock.calls[2]
    expect(finalOptions?.final).toBe(true)
    expect(finalOptions?.reuseStableTopLevelNodes).toBeFalsy()
  })

  test('gives each message its own parser instance', () => {
    render(
      <>
        <Response final={false} parserId='message-b'>
          one
        </Response>
        <Response final={false} parserId='message-c'>
          two
        </Response>
      </>
    )
    const instances = parse.mock.calls.map((call) => call[1])
    expect(instances[0]).not.toBe(instances[1])
  })
})
