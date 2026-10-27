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
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { AxiosError, AxiosHeaders } from 'axios'
import { StrictMode } from 'react'
import { afterEach, assert, beforeEach, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'
import { useAuthStore } from '@/stores/auth-store'

import * as chat from '../components/chat/playground-chat'
import {
  clearContextEstimateCache,
  type ModelCapability,
  type PlaygroundPreference,
} from '../compression-api'
import * as conversationsApi from '../conversations-api'
import {
  applyConversationPatch,
  conversationSearchSchema,
  emptyConversationDocument,
  type ConversationPatch,
  type SavedConversation,
  type ConversationWrite,
} from '../conversations-api'
import { Playground } from '../index'
import * as pending from '../lib/storage/pending-conversations'

let records: Map<number, SavedConversation>
let client: QueryClient
let failSave: boolean
let failDelete: boolean
let completions: { text: string; finish: (content?: string) => void }[]
let completionError: { code?: string; message: string } | null
let modelCapabilities: ModelCapability[]
let groupCapabilities: Record<string, ModelCapability[]>
let preference: PlaygroundPreference

function row(id: number, title: string): SavedConversation {
  const document = emptyConversationDocument()
  document.config = { ...document.config, model: 'test-model', stream: false }
  document.draft = `draft ${title}`
  document.titleGeneration = title ? 'manual' : 'awaiting_reply'
  return { id, title, revision: 1, create_time: id, update_time: id, document }
}
// The server's answer for a conversation that was deleted.
function notFound() {
  return new AxiosError(
    'Conversation not found',
    'ERR_BAD_REQUEST',
    undefined,
    undefined,
    {
      data: { success: false, message: 'Conversation not found' },
      status: 404,
      statusText: 'Not Found',
      headers: {},
      config: { headers: new AxiosHeaders() },
    }
  )
}
beforeEach(() => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  localStorage.clear()
  clearContextEstimateCache()
  useAuthStore.getState().auth.setUser({ id: 1, username: 'tester', role: 1 })
  records = new Map([
    [1, row(1, 'Alpha')],
    [2, row(2, 'Beta')],
  ])
  completions = []
  completionError = null
  modelCapabilities = []
  groupCapabilities = {}
  preference = { model: '', automatic: false, revision: 0 }
  failSave = failDelete = false
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  vi.spyOn(pending, 'readPendingConversations').mockResolvedValue([])
  vi.spyOn(pending, 'writePendingConversation').mockResolvedValue()
  vi.spyOn(api, 'get').mockImplementation(async (url, config) => {
    if (url === '/api/playground/settings') {
      return {
        data: {
          success: true,
          data: preference,
        },
      }
    }
    if (url === '/api/playground/model-capabilities') {
      return {
        data: {
          success: true,
          data: groupCapabilities[config?.params.group] ?? modelCapabilities,
        },
      }
    }
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
    if (!item) throw notFound()
    return { data: { success: true, data: structuredClone(item) } }
  })
  vi.spyOn(api, 'put').mockImplementation(async (url, body) => {
    if (failSave) throw new Error('Save unavailable')
    if (url === '/api/playground/settings') {
      preference = {
        ...(body as PlaygroundPreference),
        revision: preference.revision + 1,
      }
      return { data: { success: true, data: preference } }
    }
    const write = JSON.parse(body as string) as ConversationWrite
    const id = Number(url?.split('/').at(-1))
    const previous = records.get(id)
    if (!previous) throw notFound()
    const value = {
      ...previous,
      title: write.title,
      document: write.document,
      revision: previous.revision + 1,
    }
    records.set(id, structuredClone(value))
    return { data: { success: true, data: value } }
  })
  vi.spyOn(api, 'patch').mockImplementation(async (url, body) => {
    if (failSave) throw new Error('Save unavailable')
    const patch = JSON.parse(body as string) as ConversationPatch
    const id = Number(url?.split('/').at(-1))
    const previous = records.get(id)
    if (!previous) throw notFound()
    const value = {
      ...previous,
      title: patch.title ?? previous.title,
      document: applyConversationPatch(previous.document, patch.patch),
      revision: previous.revision + 1,
    }
    records.set(id, structuredClone(value))
    return { data: { success: true, data: value } }
  })
  vi.spyOn(api, 'post').mockImplementation(async (url, body) => {
    if (url === '/api/playground/context/estimate') {
      const payload = body as { messages: { content: string }[] }
      const tokens = payload.messages.map((message) => message.content.length)
      return {
        data: {
          success: true,
          data: {
            input_tokens: tokens.reduce((sum, count) => sum + count, 0),
            message_tokens: tokens,
          },
        },
      }
    }
    if (url === '/pg/chat/completions') {
      if (completionError) {
        throw {
          message: completionError.message,
          response: {
            data: {
              error: {
                code: completionError.code,
                message: completionError.message,
              },
            },
          },
        }
      }
      const payload = body as { messages: { role: string; content: string }[] }
      const text = payload.messages.at(-1)?.content ?? ''
      return await new Promise((resolve) =>
        completions.push({
          text,
          finish: (content = `Reply to ${text}`) =>
            resolve({
              data: {
                choices: [
                  {
                    message: { role: 'assistant', content },
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
  // Unmount before resetting: clearing the client under a mounted playground
  // makes its queries refetch, and once the mocks are restored that refetch
  // reaches the real origin, gets 401 and signs out the next test.
  cleanup()
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

it('shows the current context and draft usage from the input toolbar and updates after editing', async () => {
  modelCapabilities = [
    {
      model: 'test-model',
      context_window: 4120,
      input_limit: 0,
      output_limit: 0,
      text_generation: true,
      compression_warning: false,
    },
  ]
  renderPlayground()
  const ring = await screen.findByRole('button', {
    name: 'Model context usage',
  })
  await waitFor(() =>
    expect(ring).toHaveAccessibleDescription('11 / 24 tokens · 45.83%')
  )
  fireEvent.pointerEnter(ring, { pointerType: 'mouse' })
  fireEvent.mouseOver(ring)
  fireEvent.mouseEnter(ring)
  fireEvent.mouseMove(ring)
  expect(await screen.findByText('11 / 24 tokens · 45.83%')).toBeVisible()
  fireEvent.mouseLeave(ring)
  fireEvent.click(ring)
  expect(
    await screen.findByRole('button', { name: 'Compression settings' })
  ).toBeEnabled()
  expect(
    screen.getByRole('button', { name: 'Compress context' })
  ).toBeDisabled()
  fireEvent.click(ring)
  fireEvent.change(screen.getByPlaceholderText('Ask anything'), {
    target: { value: 'A longer draft' },
  })
  await waitFor(() =>
    expect(ring).toHaveAccessibleDescription('14 / 24 tokens · 58.33%')
  )
  expect(completions).toHaveLength(0)
})

it('opens context actions on a touch long press without closing on release and shows unknown limits honestly', async () => {
  renderPlayground()
  const ring = await screen.findByRole('button', {
    name: 'Model context usage',
  })
  // Without a known window the count is shown alone, never a guessed share.
  await waitFor(() =>
    expect(ring).toHaveAccessibleDescription(
      /^[\d,]+ tokens \(context limit unknown\)$/
    )
  )
  vi.useFakeTimers()
  try {
    fireEvent.pointerDown(ring, {
      clientX: 10,
      clientY: 10,
      pointerType: 'touch',
    })
    // A resting finger still jitters, so a small drift keeps the press alive.
    fireEvent.pointerMove(ring, {
      clientX: 14,
      clientY: 12,
      pointerType: 'touch',
    })
    await act(async () => vi.advanceTimersByTime(450))
    expect(
      screen.getByRole('button', { name: 'Compression settings' })
    ).toBeVisible()
    fireEvent.pointerUp(ring, { pointerType: 'touch' })
    fireEvent.click(ring)
    expect(
      screen.getByRole('button', { name: 'Compression settings' })
    ).toBeVisible()
  } finally {
    vi.useRealTimers()
  }
  expect(completions).toHaveLength(0)
})

it('cancels the touch long press when the finger drags the message list instead of pressing', async () => {
  renderPlayground()
  const ring = await screen.findByRole('button', {
    name: 'Model context usage',
  })
  vi.useFakeTimers()
  try {
    fireEvent.pointerDown(ring, {
      clientX: 10,
      clientY: 10,
      pointerType: 'touch',
    })
    fireEvent.pointerMove(ring, {
      clientX: 10,
      clientY: 96,
      pointerType: 'touch',
    })
    await act(async () => vi.advanceTimersByTime(450))
    expect(
      screen.queryByRole('button', { name: 'Compression settings' })
    ).not.toBeInTheDocument()
  } finally {
    vi.useRealTimers()
  }
  expect(completions).toHaveLength(0)
})

it('selects an independent compression group and saves the default model without changing the chat group', async () => {
  groupCapabilities.DSS = [
    {
      model: 'gpt-4o-mini',
      context_window: 128000,
      input_limit: 0,
      output_limit: 16384,
      text_generation: true,
      compression_warning: false,
    },
  ]
  renderPlayground()
  fireEvent.click(
    await screen.findByRole('button', { name: 'Model context usage' })
  )
  fireEvent.click(
    await screen.findByRole('button', { name: 'Compression settings' })
  )
  const dialog = await screen.findByRole('dialog', {
    name: 'Compression settings',
  })
  fireEvent.click(within(dialog).getByRole('tab', { name: 'Default settings' }))
  fireEvent.click(
    within(dialog).getByRole('combobox', { name: 'Current conversation group' })
  )
  fireEvent.click(await screen.findByRole('option', { name: /^DSS/ }))
  await waitFor(() =>
    expect(preference).toMatchObject({
      group: 'DSS',
      model: '',
      automatic: false,
    })
  )
  const picker = within(dialog).getByRole('combobox', { name: 'Model' })
  await waitFor(() => expect(picker).toBeEnabled())
  fireEvent.click(picker)
  fireEvent.click(await screen.findByRole('option', { name: 'gpt-4o-mini' }))
  await waitFor(() =>
    expect(preference).toMatchObject({
      group: 'DSS',
      model: 'gpt-4o-mini',
      automatic: true,
    })
  )
  expect(records.get(1)?.document.config).toMatchObject({
    model: 'test-model',
    group: 'default',
  })
  fireEvent.click(
    within(dialog).getByRole('tab', { name: 'This conversation' })
  )
  expect(within(dialog).getByRole('combobox', { name: 'DSS' })).toBeVisible()
})

it.each(['conversation', 'default', 'legacy'])(
  'compresses using the %s group setting and keeps chat requests in their own group',
  async (scope) => {
    modelCapabilities = [
      {
        model: 'test-model',
        context_window: 5000,
        input_limit: 0,
        output_limit: 0,
        text_generation: true,
        compression_warning: false,
      },
      {
        model: 'other-model',
        context_window: 128000,
        input_limit: 0,
        output_limit: 0,
        text_generation: true,
        compression_warning: false,
      },
    ]
    const first = records.get(1)
    assert(first)
    const settings = {
      model: 'other-model',
      group: scope === 'legacy' ? undefined : 'DSS',
      automatic: true,
    }
    if (scope === 'default') preference = { ...settings, revision: 1 }
    else first.document.compressionSettings = settings
    if (scope !== 'legacy') {
      groupCapabilities = {
        default: [modelCapabilities[0]],
        DSS: [modelCapabilities[1]],
      }
    }
    first.document.messages = Array.from({ length: 8 }, (_, index) => ({
      key: `history-${index}`,
      from: index % 2 ? 'assistant' : 'user',
      status: 'complete',
      versions: [
        { id: `original-${index}`, content: String(index).repeat(100) },
      ],
    }))
    const original = structuredClone(first.document.messages)
    renderPlayground()
    await screen.findByDisplayValue('draft Alpha')
    fireEvent.change(screen.getByPlaceholderText('Ask anything'), {
      target: { value: 'Continue' },
    })
    fireEvent.click(screen.getAllByRole('button', { name: /^Send/ })[0])
    await waitFor(() => expect(completions).toHaveLength(1))
    const calls = () =>
      vi
        .mocked(api.post)
        .mock.calls.filter(([url]) => url === '/pg/chat/completions')
    // The summary request is the first and only compression request and
    // already uses the compression model, so a separate group never leaks
    // into the chat request.
    expect(calls()[0][1]).toMatchObject({
      model: 'other-model',
      group: scope === 'legacy' ? 'default' : 'DSS',
      max_tokens: 4096,
      stream: false,
    })
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Export conversation' })
      ).toBeDisabled()
    )
    expect(records.get(1)?.document.compressionAttempt).toBe('requested')
    await act(async () => completions[0].finish('Summary'))
    await waitFor(() => expect(completions).toHaveLength(2))
    expect(records.get(1)?.document.compression?.summary).toBe(
      '## Context handoff\nSummary'
    )
    expect(calls()[1][1]).toMatchObject({
      model: 'test-model',
      group: 'default',
    })
    expect(calls()[1][1]).not.toHaveProperty('max_tokens')
    await act(async () => completions[1].finish('Continued reply'))
    await screen.findByText('Continued reply')
    expect(records.get(1)?.document.messages.slice(0, 8)).toEqual(original)
  }
)

it('switches saved reply versions and shows the question on the right and the reply on the left', async () => {
  const first = records.get(1)
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
    expect(records.get(1)?.document.messages[1].selectedVersionId).toBe('a1')
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
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Export conversation' })
    ).toBeDisabled()
  )
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

it('explains a deleted conversation opened from the URL and offers the latest remaining one', async () => {
  records.delete(2)
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
  records.clear()
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
  records.delete(1)
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
    within(alert).queryByRole('button', { name: 'Load latest conversation' })
  ).toBeNull()
  expect(completions).toHaveLength(0)
  fireEvent.click(
    within(alert).getByRole('button', { name: 'Save as new conversation' })
  )
  await waitFor(() =>
    expect(
      [...records.values()].some((record) =>
        record.document.messages.some(
          (message) => message.versions[0]?.content === 'keep this prompt'
        )
      )
    ).toBe(true)
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
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Export conversation' })
    ).toBeDisabled()
  )
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
  // The request is out before the input swaps Send for Stop; wait for the
  // render instead of racing it.
  expect(
    (await screen.findAllByRole('button', { name: /^Stop/ }))[0]
  ).toBeEnabled()
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

it('does not re-render the open conversation when a reply arrives in another one', async () => {
  const chatRenders = vi.spyOn(chat, 'PlaygroundChat')
  renderPlayground()
  await screen.findByDisplayValue('draft Alpha')
  fireEvent.change(screen.getByPlaceholderText('Ask anything'), {
    target: { value: 'request A' },
  })
  fireEvent.click(screen.getAllByRole('button', { name: /^Send/ })[0])
  await waitFor(() => expect(completions).toHaveLength(1))
  fireEvent.click(screen.getByRole('button', { name: 'Beta' }))
  await screen.findByDisplayValue('draft Beta')
  // Let the opened conversation finish loading its options and usage.
  await act(() => new Promise((resolve) => setTimeout(resolve, 50)))
  const rendered = chatRenders.mock.calls.length
  await act(async () => completions[0].finish())
  await waitFor(() =>
    expect(records.get(1)?.document.messages.at(-1)?.versions[0].content).toBe(
      'Reply to request A'
    )
  )
  // The list stops marking Alpha as responding once its reply is saved.
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Alpha' })).toBeInTheDocument()
  )
  expect(chatRenders.mock.calls.length).toBe(rendered)
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
  expect(
    screen.getByRole('button', { name: 'Export conversation' })
  ).toBeEnabled()
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

it('keeps the conversation editable after a save failure and sends once saving works again', async () => {
  renderPlayground()
  await screen.findByDisplayValue('draft Alpha')
  failSave = true
  fireEvent.change(screen.getByPlaceholderText('Ask anything'), {
    target: { value: 'first try' },
  })
  fireEvent.click(screen.getAllByRole('button', { name: /^Send/ })[0])
  await screen.findByRole('alert')
  expect(completions).toHaveLength(0)
  const input = screen.getByPlaceholderText('Ask anything')
  expect(input).toBeEnabled()

  failSave = false
  fireEvent.change(input, { target: { value: 'second try' } })
  fireEvent.click(screen.getAllByRole('button', { name: /^Send/ })[0])

  await waitFor(() => expect(completions).toHaveLength(1))
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
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
    await screen.findByRole('button', { name: 'Generating title...' })
  ).toBeDisabled()
  // Utility responses are separate from chat messages.
  await act(async () => completions[0].finish())
  await waitFor(() =>
    expect(records.get(1)?.document.titleGeneration).toBe('generated')
  )
  expect(records.get(1)?.document.messages).toHaveLength(1)
  // The saved record can land before the header re-renders.
  expect(
    await screen.findByRole('button', { name: 'Generate title' })
  ).toBeEnabled()
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
  expect(await screen.findByText('Reply to Plan a garden')).toBeInTheDocument()
  await act(async () => completions[1].finish())
  await waitFor(() =>
    expect(records.get(1)?.document.titleGeneration).toBe('generated')
  )
  expect(records.get(1)?.document.messages).toHaveLength(2)
})

it('compresses with the chat model, learns its limit and retries when an unknown model rejects the context as too long', async () => {
  // The model is outside the capability table and no compression model is
  // configured; the provider reports the overflow only in text.
  const first = records.get(1)
  assert(first)
  first.document.messages = Array.from({ length: 8 }, (_, index) => ({
    key: `history-${index}`,
    from: index % 2 ? 'assistant' : 'user',
    status: 'complete',
    versions: [{ id: `original-${index}`, content: String(index).repeat(100) }],
  }))
  renderPlayground()
  await screen.findByDisplayValue('draft Alpha')
  completionError = {
    message:
      "This model's maximum context length is 32768 tokens. However, your messages resulted in 40000 tokens.",
  }
  fireEvent.change(screen.getByPlaceholderText('Ask anything'), {
    target: { value: 'Continue' },
  })
  fireEvent.click(screen.getAllByRole('button', { name: /^Send/ })[0])
  const shortcut = await screen.findByRole('button', {
    name: 'Compress context and retry',
  })
  expect(completions).toHaveLength(0)
  completionError = null
  fireEvent.click(shortcut)
  await waitFor(() => expect(completions).toHaveLength(1))
  const calls = () =>
    vi
      .mocked(api.post)
      .mock.calls.filter(([url]) => url === '/pg/chat/completions')
      .map(([, body]) => body as { model: string; messages: unknown[] })
  const summaryRequest = calls().at(-1)
  expect(summaryRequest?.model).toBe('test-model')
  expect(summaryRequest?.messages.at(-1)).toMatchObject({ role: 'user' })
  await waitFor(() =>
    expect(records.get(1)?.document.contextLimits).toEqual({
      'test-model': 32768,
    })
  )
  await act(async () => completions[0].finish('Summary of the earlier work'))
  await waitFor(() =>
    expect(records.get(1)?.document.compression?.summary).toBe(
      '## Context handoff\nSummary of the earlier work'
    )
  )
  // The failed reply is retried once, now against the compressed context.
  await waitFor(() => expect(completions).toHaveLength(2))
  await act(async () => completions[1].finish('Continued after compression'))
  await screen.findByText('Continued after compression')
})

it('explains instead of offering compression when an over-long request has no older turns to summarize', async () => {
  renderPlayground()
  await screen.findByDisplayValue('draft Alpha')
  completionError = {
    code: 'context_length_exceeded',
    message: 'Input is too long',
  }
  fireEvent.change(screen.getByPlaceholderText('Ask anything'), {
    target: { value: 'A single very long message' },
  })
  fireEvent.click(screen.getAllByRole('button', { name: /^Send/ })[0])
  await screen.findByText(
    'The conversation is too short to compress. Shorten the message or start a new conversation.'
  )
  expect(
    screen.queryByRole('button', { name: 'Compress context and retry' })
  ).not.toBeInTheDocument()
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
