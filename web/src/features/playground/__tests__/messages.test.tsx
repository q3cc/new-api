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
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { assert, expect, it } from 'vitest'

import {
  renderPlayground,
  server,
  setupPlaygroundServer,
} from './helpers/fake-playground-server'

setupPlaygroundServer()

it('switches saved reply versions and shows the question on the right and the reply on the left', async () => {
  const first = server.records.get(1)
  assert(first)
  first.document.messages = [
    {
      key: 'question',
      from: 'user',
      versions: [{ id: 'q1', content: 'Version question' }],
    },
    {
      key: 'answer',
      from: 'assistant',
      status: 'complete',
      selectedVersionId: 'a2',
      versions: [
        { id: 'a1', content: 'First answer', state: { status: 'complete' } },
        { id: 'a2', content: 'Second answer' },
      ],
    },
  ]
  const view = renderPlayground()
  expect(await screen.findByText('Second answer')).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: 'Previous reply' }))
  expect(await screen.findByText('First answer')).toBeVisible()
  expect(screen.queryByText('Second answer')).not.toBeInTheDocument()
  await waitFor(() =>
    expect(server.records.get(1)?.document.messages[1].selectedVersionId).toBe(
      'a1'
    )
  )
  // Bubbles sit on their sides while their text stays left aligned.
  expect(
    screen.getByText('Version question').closest('.text-left')
  ).toHaveClass('items-end')
  expect(screen.getByText('First answer').closest('.text-left')).toHaveClass(
    'items-start'
  )
  view.unmount()
  renderPlayground()
  expect(await screen.findByText('First answer')).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: 'Next reply' }))
  expect(await screen.findByText('Second answer')).toBeVisible()
})

it('branches when an edited question is sent and returns to the original reply when switching back', async () => {
  const first = server.records.get(1)
  assert(first)
  first.document.messages = [
    {
      key: 'question',
      from: 'user',
      versions: [{ id: 'q1', content: 'Original question' }],
    },
    {
      key: 'answer',
      from: 'assistant',
      status: 'complete',
      versions: [{ id: 'a1', content: 'Original answer' }],
    },
  ]
  renderPlayground()
  expect(await screen.findByText('Original answer')).toBeVisible()
  const question = screen.getByText('Original question').closest('.group')
  assert(question instanceof HTMLElement)
  fireEvent.click(within(question).getByRole('button', { name: 'Edit' }))
  const editable = await waitFor(() => {
    const found = document.querySelector<HTMLElement>('[contenteditable=true]')
    if (!found) throw new Error('Editor not ready')
    return found
  })
  act(() => editable.focus())
  fireEvent.paste(editable, {
    clipboardData: { getData: () => ' edited' },
  })
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Save & Submit' })).toBeEnabled()
  )
  fireEvent.click(screen.getByRole('button', { name: 'Save & Submit' }))
  await waitFor(() => expect(server.completions).toHaveLength(1))
  expect(server.completions[0].text).toContain('edited')
  await act(async () => server.completions[0].finish('Branch answer'))
  expect(await screen.findByText('Branch answer')).toBeVisible()
  expect(screen.queryByText('Original answer')).not.toBeInTheDocument()
  expect(screen.getByText('2 of 2')).toBeVisible()

  fireEvent.click(screen.getByRole('button', { name: 'Previous reply' }))
  expect(await screen.findByText('Original answer')).toBeVisible()
  expect(screen.getByText('Original question')).toBeVisible()
  expect(screen.queryByText('Branch answer')).not.toBeInTheDocument()
  await waitFor(() => {
    const saved = server.records.get(1)?.document.messages[0]
    expect(saved?.selectedVersionId).toBe('q1')
    expect(saved?.versions[1].continuation?.[0].versions[0].content).toBe(
      'Branch answer'
    )
  })
})

it('does not start a charged request when saving the user message fails', async () => {
  renderPlayground()
  await screen.findByDisplayValue('draft Alpha')
  server.failSave = true
  fireEvent.change(screen.getByPlaceholderText('Ask anything'), {
    target: { value: 'keep this prompt' },
  })
  fireEvent.click(screen.getAllByRole('button', { name: /^Send/ })[0])
  await screen.findByRole('alert')
  expect(server.completions).toHaveLength(0)
  // The question goes back into the input instead of sitting unsent in the chat.
  expect(screen.getByPlaceholderText('Ask anything')).toHaveValue(
    'keep this prompt'
  )
  expect(
    screen.queryByText('keep this prompt', { ignore: 'textarea' })
  ).not.toBeInTheDocument()
  server.failSave = false
  fireEvent.click(
    within(screen.getByRole('alert')).getByRole('button', { name: 'Retry' })
  )
  await waitFor(() =>
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  )
  expect(server.completions).toHaveLength(0)
  expect(server.records.get(1)?.document.messages).toHaveLength(0)
  expect(server.records.get(1)?.document.draft).toBe('keep this prompt')
})

it('stops a running reply with Escape and announces the outcome to screen readers', async () => {
  renderPlayground()
  await screen.findByDisplayValue('draft Alpha')
  const input = screen.getByPlaceholderText('Ask anything')
  fireEvent.change(input, { target: { value: 'take your time' } })
  fireEvent.click(screen.getAllByRole('button', { name: /^Send/ })[0])
  await waitFor(() => expect(server.completions).toHaveLength(1))
  expect(await screen.findByText('Generating reply...')).toBeInTheDocument()
  fireEvent.keyDown(input, { key: 'Escape' })
  await waitFor(() =>
    expect(
      screen.queryByRole('button', { name: /^Stop/ })
    ).not.toBeInTheDocument()
  )
  expect(
    screen.getByText('Generation was interrupted', { selector: '.sr-only' })
  ).toBeInTheDocument()
})

it('asks before discarding local changes on a conflict and points out a conversation updated elsewhere', async () => {
  renderPlayground()
  await screen.findByDisplayValue('draft Alpha')
  const first = server.records.get(1)
  assert(first)
  server.records.set(1, { ...first, revision: 3, title: 'Alpha (elsewhere)' })
  await act(async () => {
    await server.client.invalidateQueries({
      queryKey: ['playground-conversations'],
    })
  })
  expect(
    await screen.findByText('This conversation was updated elsewhere.')
  ).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
  await screen.findByDisplayValue('draft Alpha')
  await waitFor(() =>
    expect(
      screen.queryByText('This conversation was updated elsewhere.')
    ).not.toBeInTheDocument()
  )

  server.records.set(1, { ...first, revision: 7 })
  fireEvent.change(screen.getByPlaceholderText('Ask anything'), {
    target: { value: 'conflicting' },
  })
  fireEvent.click(screen.getAllByRole('button', { name: /^Send/ })[0])
  const alert = await screen.findByRole('alert')
  fireEvent.click(
    within(alert).getByRole('button', {
      name: 'Discard local changes and load latest',
    })
  )
  const dialog = await screen.findByRole('alertdialog')
  fireEvent.click(within(dialog).getByRole('button', { name: 'Load latest' }))
  await waitFor(() =>
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  )
  expect(screen.queryByText('conflicting')).not.toBeInTheDocument()
})

it('restores the default parameters from the panel', async () => {
  const first = server.records.get(1)
  assert(first)
  first.document.config = { ...first.document.config, temperature: 1.5 }
  first.document.parameterEnabled = {
    ...first.document.parameterEnabled,
    seed: true,
  }
  renderPlayground()
  await screen.findByDisplayValue('draft Alpha')
  fireEvent.click(screen.getByRole('button', { name: 'Parameters' }))
  expect(await screen.findByText('1.5')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Restore defaults' }))
  await waitFor(() => expect(screen.queryByText('1.5')).not.toBeInTheDocument())
  expect(screen.getByText('0.7')).toBeInTheDocument()
  await waitFor(() =>
    expect(server.records.get(1)?.document.config.temperature).toBe(0.7)
  )
  expect(server.records.get(1)?.document.parameterEnabled.seed).toBe(false)
})

it('keeps the conversation editable after a save failure and sends once saving works again', async () => {
  renderPlayground()
  await screen.findByDisplayValue('draft Alpha')
  server.failSave = true
  fireEvent.change(screen.getByPlaceholderText('Ask anything'), {
    target: { value: 'first try' },
  })
  fireEvent.click(screen.getAllByRole('button', { name: /^Send/ })[0])
  await screen.findByRole('alert')
  expect(server.completions).toHaveLength(0)
  const input = screen.getByPlaceholderText('Ask anything')
  expect(input).toBeEnabled()

  server.failSave = false
  fireEvent.change(input, { target: { value: 'second try' } })
  fireEvent.click(screen.getAllByRole('button', { name: /^Send/ })[0])

  await waitFor(() => expect(server.completions).toHaveLength(1))
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
})
