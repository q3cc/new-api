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
import { expect, it, vi } from 'vitest'

import { api } from '@/lib/api'
import { useAuthStore } from '@/stores/auth-store'

import * as chat from '../components/chat/playground-chat'
import * as conversationsApi from '../conversations-api'
import {
  renderPlayground,
  server,
  setupPlaygroundServer,
} from './helpers/fake-playground-server'

setupPlaygroundServer()

it('shows upload and verification progress until the server confirms import', async () => {
  localStorage.setItem('playground_messages', '[]')
  let finish: (() => void) | undefined
  let progress: conversationsApi.ImportProgress | undefined
  let report: ((value: conversationsApi.ImportProgress) => void) | undefined
  vi.spyOn(conversationsApi, 'importConversation').mockImplementation(
    async (_source, _signal, onProgress) => {
      report = onProgress
      progress = { uploaded: 50, total: 100, phase: 'uploading' }
      onProgress?.(progress)
      await new Promise<void>((resolve) => {
        finish = resolve
      })
      onProgress?.({ uploaded: 100, total: 100, phase: 'complete' })
      return { conversation_id: 1, deleted: true }
    }
  )
  renderPlayground()
  const bar = await screen.findByRole('progressbar', {
    name: 'Conversation upload progress',
  })
  expect(bar).toHaveAttribute('aria-valuenow', '50')
  expect(screen.getByText('Uploading conversations...')).toBeVisible()
  await act(async () =>
    report?.({ uploaded: 100, total: 100, phase: 'verifying' })
  )
  expect(screen.getByText('Verifying conversations...')).toBeVisible()
  await act(async () => finish?.())
  await waitFor(() =>
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
  )
  expect(localStorage.getItem('playground_messages')).toBeNull()
})

it('restores the URL-selected conversation and switches independent drafts', async () => {
  const view = renderPlayground('?conversation=2')
  await screen.findByDisplayValue('draft Beta')
  fireEvent.click(await screen.findByRole('button', { name: 'Alpha' }))
  await screen.findByDisplayValue('draft Alpha')
  expect(view.router.state.location.search).toMatchObject({ conversation: 1 })
  fireEvent.change(screen.getByPlaceholderText('Ask anything'), {
    target: { value: 'edited Alpha' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Beta' }))
  await screen.findByDisplayValue('draft Beta')
  fireEvent.click(screen.getByRole('button', { name: 'Alpha' }))
  await screen.findByDisplayValue('edited Alpha')
})

it('opens an empty conversation when there is no server history', async () => {
  server.records.clear()
  renderPlayground('')
  const input = await screen.findByPlaceholderText('Ask anything')
  expect(input).toHaveValue('')
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Export conversation' })
    ).toBeDisabled()
  )
  fireEvent.change(input, { target: { value: 'first draft' } })
  await waitFor(
    () =>
      expect(
        [...server.records.values()].some(
          (record) => record.document.draft === 'first draft'
        )
      ).toBe(true),
    { timeout: 4000 }
  )
})

it('continues each request after switching and writes replies to their originating conversations', async () => {
  renderPlayground()
  await screen.findByDisplayValue('draft Alpha')
  fireEvent.change(screen.getByPlaceholderText('Ask anything'), {
    target: { value: 'request A' },
  })
  fireEvent.click(screen.getAllByRole('button', { name: /^Send/ })[0])
  await waitFor(() => expect(server.completions).toHaveLength(1))
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Export conversation' })
    ).toBeDisabled()
  )
  expect(server.records.get(1)?.document.messages[0].versions[0].content).toBe(
    'request A'
  )
  fireEvent.click(screen.getByRole('button', { name: 'Beta' }))
  await screen.findByDisplayValue('draft Beta')
  fireEvent.change(screen.getByPlaceholderText('Ask anything'), {
    target: { value: 'request B' },
  })
  fireEvent.click(screen.getAllByRole('button', { name: /^Send/ })[0])
  await waitFor(() => expect(server.completions).toHaveLength(2))
  await act(async () => server.completions[0].finish())
  expect(screen.queryByText('Reply to request A')).not.toBeInTheDocument()
  // The request is out before the input swaps Send for Stop; wait for the
  // render instead of racing it.
  expect(
    (await screen.findAllByRole('button', { name: /^Stop/ }))[0]
  ).toBeEnabled()
  fireEvent.click(screen.getByRole('button', { name: 'Alpha' }))
  await screen.findByText('Reply to request A')
  await act(async () => server.completions[1].finish())
  await waitFor(() =>
    expect(
      server.records.get(2)?.document.messages.at(-1)?.versions[0].content
    ).toBe('Reply to request B')
  )
  expect(
    server.records.get(1)?.document.messages.at(-1)?.versions[0].content
  ).toBe('Reply to request A')
})

it('does not re-render the open conversation when a reply arrives in another one', async () => {
  const chatRenders = vi.spyOn(chat, 'PlaygroundChat')
  renderPlayground()
  await screen.findByDisplayValue('draft Alpha')
  fireEvent.change(screen.getByPlaceholderText('Ask anything'), {
    target: { value: 'request A' },
  })
  fireEvent.click(screen.getAllByRole('button', { name: /^Send/ })[0])
  await waitFor(() => expect(server.completions).toHaveLength(1))
  fireEvent.click(screen.getByRole('button', { name: 'Beta' }))
  await screen.findByDisplayValue('draft Beta')
  // Let the opened conversation finish loading its options and usage.
  await act(() => new Promise((resolve) => setTimeout(resolve, 50)))
  const rendered = chatRenders.mock.calls.length
  await act(async () => server.completions[0].finish())
  await waitFor(() =>
    expect(
      server.records.get(1)?.document.messages.at(-1)?.versions[0].content
    ).toBe('Reply to request A')
  )
  // The list stops marking Alpha as responding once its reply is saved.
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Alpha' })).toBeInTheDocument()
  )
  expect(chatRenders.mock.calls.length).toBe(rendered)
})

it('aborts the previous account request and ignores its delayed reply after logout', async () => {
  renderPlayground()
  await screen.findByDisplayValue('draft Alpha')
  fireEvent.change(screen.getByPlaceholderText('Ask anything'), {
    target: { value: 'before logout' },
  })
  fireEvent.click(screen.getAllByRole('button', { name: /^Send/ })[0])
  await waitFor(() => expect(server.completions).toHaveLength(1))
  const request = vi
    .mocked(api.post)
    .mock.calls.find(([url]) => url === '/pg/chat/completions')
  const signal = request?.[2]?.signal
  await act(async () => useAuthStore.getState().auth.reset())
  expect(signal?.aborted).toBe(true)
  await act(async () => server.completions[0].finish())
  expect(
    server.records.get(1)?.document.messages.at(-1)?.versions[0].content
  ).not.toContain('Reply to')
})
