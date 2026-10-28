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
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { assert, expect, it, vi } from 'vitest'

import {
  renderPlayground,
  row,
  server,
  setupPlaygroundServer,
  skipDeleteDelay,
} from './helpers/fake-playground-server'

setupPlaygroundServer()

it('asks before deleting a message', async () => {
  const first = server.records.get(1)
  assert(first)
  first.document.messages = [
    {
      key: 'question',
      from: 'user',
      versions: [{ id: 'q1', content: 'Keep me?' }],
    },
    {
      key: 'answer',
      from: 'assistant',
      status: 'complete',
      versions: [{ id: 'a1', content: 'Reply to keep' }],
    },
  ]
  renderPlayground()
  expect(await screen.findByText('Reply to keep')).toBeVisible()
  const answer = screen.getByText('Reply to keep').closest('.group')
  assert(answer instanceof HTMLElement)
  vi.useFakeTimers({ shouldAdvanceTime: true })
  fireEvent.click(within(answer).getByRole('button', { name: 'Delete' }))
  const dialog = await screen.findByRole('alertdialog')
  await skipDeleteDelay()
  expect(screen.getByText('Reply to keep')).toBeVisible()
  fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }))
  await waitFor(() =>
    expect(screen.queryByText('Reply to keep')).not.toBeInTheDocument()
  )
  expect(screen.getByText('Keep me?')).toBeVisible()
})

it('explains a deleted conversation opened from the URL and offers the latest remaining one', async () => {
  server.records.delete(2)
  const view = renderPlayground('?conversation=2')
  expect(
    await screen.findByText('This conversation no longer exists')
  ).toBeInTheDocument()
  expect(
    screen.queryByRole('button', { name: 'Retry' })
  ).not.toBeInTheDocument()
  // The header names no conversation while none is open.
  expect(
    screen.queryByText('New conversation', { selector: 'header span' })
  ).not.toBeInTheDocument()
  fireEvent.click(
    screen.getByRole('button', { name: 'Open latest conversation' })
  )
  await screen.findByDisplayValue('draft Alpha')
  expect(view.router.state.location.search).toMatchObject({ conversation: 1 })
})

it('starts a new conversation from a deleted one when no other conversation remains', async () => {
  server.records.clear()
  renderPlayground('?conversation=2')
  await screen.findByText('This conversation no longer exists')
  expect(
    screen.queryByRole('button', { name: 'Open latest conversation' })
  ).not.toBeInTheDocument()
  fireEvent.click(
    screen.getByRole('button', { name: 'Start a new conversation' })
  )
  expect(await screen.findByPlaceholderText('Ask anything')).toHaveValue('')
  expect(
    screen.queryByText('This conversation no longer exists')
  ).not.toBeInTheDocument()
})

it('offers only saving as new when the open conversation was deleted elsewhere', async () => {
  renderPlayground()
  await screen.findByDisplayValue('draft Alpha')
  server.records.delete(1)
  fireEvent.change(screen.getByPlaceholderText('Ask anything'), {
    target: { value: 'keep this prompt' },
  })
  fireEvent.click(screen.getAllByRole('button', { name: /^Send/ })[0])
  const alert = await screen.findByRole('alert')
  expect(alert).toHaveTextContent(
    'This conversation was deleted elsewhere. Save it as a new conversation to keep these messages.'
  )
  expect(within(alert).queryByRole('button', { name: 'Retry' })).toBeNull()
  expect(
    within(alert).queryByRole('button', {
      name: 'Discard local changes and load latest',
    })
  ).toBeNull()
  expect(server.completions).toHaveLength(0)
  fireEvent.click(
    within(alert).getByRole('button', { name: 'Save as new conversation' })
  )
  await waitFor(() =>
    expect(
      [...server.records.values()].some((record) =>
        record.document.messages.some(
          (message) => message.versions[0]?.content === 'keep this prompt'
        )
      )
    ).toBe(true)
  )
})

it('shows older messages and clears only the current conversation after confirmation', async () => {
  const alpha = server.records.get(1) ?? row(1, 'Alpha')
  alpha.document.messages = Array.from({ length: 30 }, (_, index) => ({
    key: String(index),
    from: 'user',
    versions: [{ id: 'v1', content: `History ${index}` }],
  }))
  server.records.set(1, alpha)
  const beta = server.records.get(2) ?? row(2, 'Beta')
  beta.document.messages = [
    {
      key: 'beta',
      from: 'user',
      versions: [{ id: 'b1', content: 'Preserved Beta' }],
    },
  ]
  server.records.set(2, beta)
  renderPlayground()
  await screen.findByText('History 29')
  expect(
    screen.queryByText('History 0', { exact: true })
  ).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Show earlier messages' }))
  await screen.findByText('History 0', { exact: true })
  vi.useFakeTimers({ shouldAdvanceTime: true })
  fireEvent.click(screen.getByRole('button', { name: 'Clear chat history' }))
  const dialog = await screen.findByRole('alertdialog')
  await skipDeleteDelay()
  fireEvent.click(within(dialog).getByRole('button', { name: 'Clear' }))
  await waitFor(() =>
    expect(server.records.get(1)?.document.messages).toEqual([])
  )
  expect(server.records.get(2)?.document.messages[0].versions[0].content).toBe(
    'Preserved Beta'
  )
})

it('keeps a failed deletion confirmation open and supports retry', async () => {
  renderPlayground()
  await screen.findByDisplayValue('draft Alpha')
  server.failDelete = true
  vi.useFakeTimers({ shouldAdvanceTime: true })
  fireEvent.click(screen.getByRole('button', { name: 'Delete conversation' }))
  const dialog = await screen.findByRole('alertdialog')
  await skipDeleteDelay()
  fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }))
  await within(dialog).findByText('Delete unavailable')
  expect(server.records.has(1)).toBe(true)
  server.failDelete = false
  fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }))
  await waitFor(() =>
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  )
  expect(server.records.has(1)).toBe(false)
  expect(server.records.has(2)).toBe(true)
})
