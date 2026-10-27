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
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { expect, it } from 'vitest'

import {
  renderPlayground,
  row,
  server,
  setupPlaygroundServer,
} from './helpers/fake-playground-server'

setupPlaygroundServer()

it('automatically titles imported history and displays progress without adding a chat message', async () => {
  const imported = row(1, 'Imported conversation')
  delete imported.document.titleGeneration
  imported.document.messages = [
    {
      key: 'legacy',
      from: 'user',
      versions: [{ id: 'v1', content: 'Plan a garden' }],
    },
  ]
  server.records.set(1, imported)
  renderPlayground()
  await waitFor(() => expect(server.completions).toHaveLength(1))
  expect(
    await screen.findByRole('button', { name: 'Generating title...' })
  ).toBeDisabled()
  // Utility responses are separate from chat messages.
  await act(async () => server.completions[0].finish())
  await waitFor(() =>
    expect(server.records.get(1)?.document.titleGeneration).toBe('generated')
  )
  expect(server.records.get(1)?.document.messages).toHaveLength(1)
  // The saved record can land before the header re-renders.
  expect(
    await screen.findByRole('button', { name: 'Generate title' })
  ).toBeEnabled()
  expect(server.records.get(1)?.title).toContain('Plan a garden')
})

it('generates a title after the first new reply and keeps the title response out of chat', async () => {
  server.records.set(1, row(1, ''))
  renderPlayground()
  await screen.findByPlaceholderText('Ask anything')
  fireEvent.change(screen.getByPlaceholderText('Ask anything'), {
    target: { value: 'Plan a garden' },
  })
  fireEvent.click(screen.getAllByRole('button', { name: /^Send/ })[0])
  await waitFor(() => expect(server.completions).toHaveLength(1))
  await act(async () => server.completions[0].finish())
  await waitFor(() => expect(server.completions).toHaveLength(2))
  expect(await screen.findByText('Reply to Plan a garden')).toBeInTheDocument()
  await act(async () => server.completions[1].finish())
  await waitFor(() =>
    expect(server.records.get(1)?.document.titleGeneration).toBe('generated')
  )
  expect(server.records.get(1)?.document.messages).toHaveLength(2)
})

it('offers retry for an interrupted title without automatically requesting it again', async () => {
  const existing = row(1, 'Temporary title')
  existing.document.titleGeneration = 'requested'
  existing.document.messages = [
    {
      key: 'legacy',
      from: 'user',
      versions: [{ id: 'v1', content: 'Plan a garden' }],
    },
  ]
  server.records.set(1, existing)
  renderPlayground()
  await screen.findByText('Title not generated')
  expect(server.completions).toHaveLength(0)
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
  await waitFor(() => expect(server.completions).toHaveLength(1))
  await act(async () => server.completions[0].finish())
  await waitFor(() =>
    expect(screen.queryByText('Title not generated')).not.toBeInTheDocument()
  )
})
