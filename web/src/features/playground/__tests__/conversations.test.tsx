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
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router'
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { StrictMode } from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'
import { useAuthStore } from '@/stores/auth-store'

import * as conversationsApi from '../conversations-api'
import {
  conversationSearchSchema,
  emptyConversationDocument,
  type SavedConversation,
  type ConversationWrite,
} from '../conversations-api'
import { Playground } from '../index'
import * as pending from '../lib/storage/pending-conversations'

let records: Map<number, SavedConversation>
let client: QueryClient
let failSave: boolean
let failDelete: boolean
let completions: { text: string; finish: () => void }[]

function row(id: number, title: string): SavedConversation {
  const document = emptyConversationDocument()
  document.config = { ...document.config, model: 'test-model', stream: false }
  document.draft = `draft ${title}`
  document.titleGeneration = title ? 'manual' : 'awaiting_reply'
  return { id, title, revision: 1, create_time: id, update_time: id, document }
}
beforeEach(() => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  localStorage.clear()
  useAuthStore.getState().auth.setUser({ id: 1, username: 'tester', role: 1 })
  records = new Map([
    [1, row(1, 'Alpha')],
    [2, row(2, 'Beta')],
  ])
  completions = []
  failSave = failDelete = false
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  vi.spyOn(pending, 'readPendingConversations').mockResolvedValue([])
  vi.spyOn(pending, 'writePendingConversation').mockResolvedValue()
  vi.spyOn(api, 'get').mockImplementation(async (url, config) => {
    if (url === '/api/user/self/groups') {
      return {
        data: {
          success: true,
          data: {
            default: { desc: 'Default', ratio: 1 },
            DSS: { desc: 'DSS', ratio: 1 },
          },
        },
      }
    }
    if (url === '/api/user/models') {
      return { data: { success: true, data: ['test-model', 'other-model'] } }
    }
    if (url === '/api/playground/conversations') {
      const keyword = config?.params.keyword ?? ''
      const items = [...records.values()]
        .filter((item) => item.title.includes(keyword))
        .sort((a, b) => b.update_time - a.update_time)
      const offset = ((config?.params.p ?? 1) - 1) * 30
      return {
        data: {
          success: true,
          data: {
            items: structuredClone(items.slice(offset, offset + 30)),
            total: items.length,
          },
        },
      }
    }
    const item = records.get(Number(url?.split('/').at(-1)))
    if (!item) throw new Error('Conversation not found')
    return { data: { success: true, data: structuredClone(item) } }
  })
  vi.spyOn(api, 'put').mockImplementation(async (url, body) => {
    if (failSave) throw new Error('Save unavailable')
    const write = JSON.parse(body as string) as ConversationWrite
    const id = Number(url?.split('/').at(-1))
    const previous = records.get(id) ?? row(id, '')
    const value = {
      ...previous,
      title: write.title,
      document: write.document,
      revision: previous.revision + 1,
    }
    records.set(id, structuredClone(value))
    return { data: { success: true, data: value } }
  })
  vi.spyOn(api, 'post').mockImplementation(async (url, body) => {
    if (url === '/pg/chat/completions') {
      const payload = body as { messages: { role: string; content: string }[] }
      const text = payload.messages.at(-1)?.content ?? ''
      return await new Promise((resolve) =>
        completions.push({
          text,
          finish: () =>
            resolve({
              data: {
                choices: [
                  {
                    message: { role: 'assistant', content: `Reply to ${text}` },
                    finish_reason: 'stop',
                  },
                ],
              },
            }),
        })
      )
    }
    const write = JSON.parse(body as string) as ConversationWrite
    const next = {
      ...row(records.size + 1, write.title),
      document: write.document,
    }
    records.set(next.id, structuredClone(next))
    return { data: { success: true, data: next } }
  })
  vi.spyOn(api, 'delete').mockImplementation(async (url) => {
    if (failDelete) throw new Error('Delete unavailable')
    records.delete(Number(url?.split('/').at(-1)))
    return { data: { success: true, data: null } }
  })
})
afterEach(() => {
  useAuthStore.getState().auth.reset()
  client.clear()
  vi.restoreAllMocks()
})

function renderPlayground(search = '?conversation=1') {
  const root = createRootRoute({ component: Outlet })
  const authenticated = createRoute({
    getParentRoute: () => root,
    id: '_authenticated',
    component: Outlet,
  })
  const route = createRoute({
    getParentRoute: () => authenticated,
    path: '/playground/',
    validateSearch: conversationSearchSchema,
    component: Playground,
  })
  const history = createMemoryHistory({
    initialEntries: [`/playground/${search}`],
  })
  const router = createRouter({
    routeTree: root.addChildren([authenticated.addChildren([route])]),
    history,
  })
  const view = render(
    <StrictMode>
      <QueryClientProvider client={client}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </StrictMode>
  )
  return { ...view, router }
}

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
  records.clear()
  renderPlayground('')
  const input = await screen.findByPlaceholderText('Ask anything')
  expect(input).toHaveValue('')
  fireEvent.change(input, { target: { value: 'first draft' } })
  await waitFor(
    () =>
      expect(
        [...records.values()].some(
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
  await waitFor(() => expect(completions).toHaveLength(1))
  expect(records.get(1)?.document.messages[0].versions[0].content).toBe(
    'request A'
  )
  fireEvent.click(screen.getByRole('button', { name: 'Beta' }))
  await screen.findByDisplayValue('draft Beta')
  fireEvent.change(screen.getByPlaceholderText('Ask anything'), {
    target: { value: 'request B' },
  })
  fireEvent.click(screen.getAllByRole('button', { name: /^Send/ })[0])
  await waitFor(() => expect(completions).toHaveLength(2))
  await act(async () => completions[0].finish())
  expect(screen.queryByText('Reply to request A')).not.toBeInTheDocument()
  expect(screen.getAllByRole('button', { name: /^Stop/ })[0]).toBeEnabled()
  fireEvent.click(screen.getByRole('button', { name: 'Alpha' }))
  await screen.findByText('Reply to request A')
  await act(async () => completions[1].finish())
  await waitFor(() =>
    expect(records.get(2)?.document.messages.at(-1)?.versions[0].content).toBe(
      'Reply to request B'
    )
  )
  expect(records.get(1)?.document.messages.at(-1)?.versions[0].content).toBe(
    'Reply to request A'
  )
})

it('does not start a charged request when saving the user message fails', async () => {
  renderPlayground()
  await screen.findByDisplayValue('draft Alpha')
  failSave = true
  fireEvent.change(screen.getByPlaceholderText('Ask anything'), {
    target: { value: 'keep this prompt' },
  })
  fireEvent.click(screen.getAllByRole('button', { name: /^Send/ })[0])
  await screen.findByRole('alert')
  expect(completions).toHaveLength(0)
  expect(screen.getByText('keep this prompt')).toBeInTheDocument()
  failSave = false
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
  await waitFor(() =>
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  )
  expect(completions).toHaveLength(0)
  expect(records.get(1)?.document.messages[0].versions[0].content).toBe(
    'keep this prompt'
  )
})

it('aborts the previous account request and ignores its delayed reply after logout', async () => {
  renderPlayground()
  await screen.findByDisplayValue('draft Alpha')
  fireEvent.change(screen.getByPlaceholderText('Ask anything'), {
    target: { value: 'before logout' },
  })
  fireEvent.click(screen.getAllByRole('button', { name: /^Send/ })[0])
  await waitFor(() => expect(completions).toHaveLength(1))
  const request = vi
    .mocked(api.post)
    .mock.calls.find(([url]) => url === '/pg/chat/completions')
  const signal = request?.[2]?.signal
  await act(async () => useAuthStore.getState().auth.reset())
  expect(signal?.aborted).toBe(true)
  await act(async () => completions[0].finish())
  expect(
    records.get(1)?.document.messages.at(-1)?.versions[0].content
  ).not.toContain('Reply to')
})

it('shows older messages and clears only the current conversation after confirmation', async () => {
  const alpha = records.get(1) ?? row(1, 'Alpha')
  alpha.document.messages = Array.from({ length: 30 }, (_, index) => ({
    key: String(index),
    from: 'user',
    versions: [{ id: 'v1', content: `History ${index}` }],
  }))
  records.set(1, alpha)
  const beta = records.get(2) ?? row(2, 'Beta')
  beta.document.messages = [
    {
      key: 'beta',
      from: 'user',
      versions: [{ id: 'b1', content: 'Preserved Beta' }],
    },
  ]
  records.set(2, beta)
  renderPlayground()
  await screen.findByText('History 29')
  expect(
    screen.queryByText('History 0', { exact: true })
  ).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Show earlier messages' }))
  await screen.findByText('History 0', { exact: true })
  fireEvent.click(screen.getByRole('button', { name: 'Clear chat history' }))
  const dialog = await screen.findByRole('alertdialog')
  fireEvent.click(within(dialog).getByRole('button', { name: 'Clear' }))
  await waitFor(() => expect(records.get(1)?.document.messages).toEqual([]))
  expect(records.get(2)?.document.messages[0].versions[0].content).toBe(
    'Preserved Beta'
  )
})

it('keeps a failed deletion confirmation open and supports retry', async () => {
  renderPlayground()
  await screen.findByDisplayValue('draft Alpha')
  failDelete = true
  fireEvent.click(screen.getByRole('button', { name: 'Delete conversation' }))
  const dialog = await screen.findByRole('alertdialog')
  fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }))
  await within(dialog).findByText('Delete unavailable')
  expect(records.has(1)).toBe(true)
  failDelete = false
  fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }))
  await waitFor(() =>
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  )
  expect(records.has(1)).toBe(false)
  expect(records.has(2)).toBe(true)
})

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
  records.set(1, imported)
  renderPlayground()
  await waitFor(() => expect(completions).toHaveLength(1))
  expect(
    screen.getByRole('button', { name: 'Generating title...' })
  ).toBeDisabled()
  // Utility responses are separate from chat messages.
  await act(async () => completions[0].finish())
  await waitFor(() =>
    expect(records.get(1)?.document.titleGeneration).toBe('generated')
  )
  expect(records.get(1)?.document.messages).toHaveLength(1)
  expect(screen.getByRole('button', { name: 'Generate title' })).toBeEnabled()
  expect(records.get(1)?.title).toContain('Plan a garden')
})

it('generates a title after the first new reply and keeps the title response out of chat', async () => {
  records.set(1, row(1, ''))
  renderPlayground()
  await screen.findByPlaceholderText('Ask anything')
  fireEvent.change(screen.getByPlaceholderText('Ask anything'), {
    target: { value: 'Plan a garden' },
  })
  fireEvent.click(screen.getAllByRole('button', { name: /^Send/ })[0])
  await waitFor(() => expect(completions).toHaveLength(1))
  await act(async () => completions[0].finish())
  await waitFor(() => expect(completions).toHaveLength(2))
  expect(screen.getByText('Reply to Plan a garden')).toBeInTheDocument()
  await act(async () => completions[1].finish())
  await waitFor(() =>
    expect(records.get(1)?.document.titleGeneration).toBe('generated')
  )
  expect(records.get(1)?.document.messages).toHaveLength(2)
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
  records.set(1, existing)
  renderPlayground()
  await screen.findByText('Title not generated')
  expect(completions).toHaveLength(0)
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
  await waitFor(() => expect(completions).toHaveLength(1))
  await act(async () => completions[0].finish())
  await waitFor(() =>
    expect(screen.queryByText('Title not generated')).not.toBeInTheDocument()
  )
})
