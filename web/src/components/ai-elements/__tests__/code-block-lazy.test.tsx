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
import { readFileSync } from 'node:fs'
import path from 'node:path'

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, test } from 'vitest'

import { CodeBlock } from '../code-block'

afterEach(() => {
  cleanup()
})

test('loads the CodeMirror editor on demand instead of with the page', () => {
  const source = readFileSync(
    path.join(process.cwd(), 'src/components/ai-elements/code-block.tsx'),
    'utf8'
  )
  // A static import would put the editor into every route that shows code.
  expect(source).not.toMatch(/from '@codemirror\//)
  expect(source).not.toMatch(/from '@lezer\//)
})

test('shows the code as text while the editor loads and then as an editor', async () => {
  render(<CodeBlock code='const answer = 42' language='typescript' />)
  expect(screen.getByText('const answer = 42')).toBeInTheDocument()
  await waitFor(() =>
    expect(document.querySelector('.cm-content')).not.toBeNull()
  )
  expect(document.querySelector('.cm-content')?.textContent).toContain(
    'const answer = 42'
  )
})
