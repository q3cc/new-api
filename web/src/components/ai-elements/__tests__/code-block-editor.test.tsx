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
import { cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, test } from 'vitest'

import { CodeBlockEditor } from '../code-block'

afterEach(() => {
  cleanup()
})

function editorTree(value: string) {
  // A fresh inline onKeyDown per call mirrors PlaygroundMessageEditor, which
  // recreates its handler on every keystroke-driven render.
  return (
    <CodeBlockEditor
      ariaLabel='Edit message'
      language='markdown'
      onChange={() => undefined}
      onKeyDown={() => undefined}
      value={value}
    />
  )
}

describe('CodeBlockEditor', () => {
  test('does not add a second vertical inset to the line-number gutter for multiline source', async () => {
    const { getByRole } = render(
      <CodeBlockEditor
        ariaLabel='Plugin source'
        autoFocus={false}
        language='javascript'
        onChange={() => undefined}
        value={'2\n1\n1'}
      />
    )

    // The editor module is loaded on demand.
    await waitFor(() =>
      expect(document.querySelector('.cm-gutters')).not.toBeNull()
    )
    const editor = getByRole('textbox', { name: 'Plugin source' })
    const gutters = editor.querySelector('.cm-gutters')

    // CodeMirror already offsets each gutter line by the content padding.
    // Extra vertical padding here shifts every number below its source line.
    expect(gutters).toHaveStyle({ paddingTop: '0px', paddingBottom: '0px' })
  })

  test('appends streamed text without rebuilding the lines already shown', async () => {
    const { rerender } = render(editorTree('line one'))
    await waitFor(() =>
      expect(document.querySelector('.cm-line')).not.toBeNull()
    )
    const firstLine = document.querySelector('.cm-line')

    rerender(editorTree('line one\nline two'))

    const lines = [...document.querySelectorAll('.cm-line')]
    expect(lines).toHaveLength(2)
    expect(lines[0]).toBe(firstLine)
    expect(lines[1]?.textContent).toBe('line two')
  })

  test('keeps the same editor instance when value and onKeyDown change on rerender', async () => {
    const { rerender } = render(editorTree('h'))

    await waitFor(() =>
      expect(document.querySelector('.cm-content')).not.toBeNull()
    )
    const contentBefore = document.querySelector('.cm-content')

    rerender(editorTree('hi'))

    const contentAfter = document.querySelector('.cm-content')
    // If the EditorView were torn down and rebuilt, the content node would be
    // replaced and the cursor would reset to the document start, making typed
    // characters pile up at the beginning (text appears right-to-left).
    expect(contentAfter).toBe(contentBefore)
    expect(contentAfter?.textContent).toContain('hi')
  })
})
