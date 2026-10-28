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
import { act, cleanup, render } from '@testing-library/react'
import { AxiosError, AxiosHeaders } from 'axios'
import { StrictMode } from 'react'
import { afterEach, beforeEach, vi } from 'vitest'

import { api, type ApiRequestConfig } from '@/lib/api'
import { useAuthStore } from '@/stores/auth-store'

import {
  clearContextEstimateCache,
  type ModelCapability,
  type PlaygroundPreference,
} from '../../compression-api'
import { DELETE_CONFIRM_DELAY_SECONDS } from '../../constants'
import {
  applyConversationPatch,
  conversationSearchSchema,
  emptyConversationDocument,
  type ConversationPatch,
  type SavedConversation,
  type ConversationWrite,
} from '../../conversations-api'
import { Playground } from '../../index'
import * as pending from '../../lib/storage/pending-conversations'

let records: Map<number, SavedConversation>
let client: QueryClient
let failSave: boolean
let failDelete: boolean
let completions: { text: string; finish: (content?: string) => void }[]
let completionError: { code?: string; message: string } | null
let modelCapabilities: ModelCapability[]
let groupCapabilities: Record<string, ModelCapability[]>
let preference: PlaygroundPreference

/** The fake server's state; tests read and change it between steps. */
export const server = {
  get records(): Map<number, SavedConversation> {
    return records
  },
  set records(value: Map<number, SavedConversation>) {
    records = value
  },
  get client(): QueryClient {
    return client
  },
  set client(value: QueryClient) {
    client = value
  },
  get failSave(): boolean {
    return failSave
  },
  set failSave(value: boolean) {
    failSave = value
  },
  get failDelete(): boolean {
    return failDelete
  },
  set failDelete(value: boolean) {
    failDelete = value
  },
  get completions(): { text: string; finish: (content?: string) => void }[] {
    return completions
  },
  set completions(
    value: { text: string; finish: (content?: string) => void }[]
  ) {
    completions = value
  },
  get completionError(): { code?: string; message: string } | null {
    return completionError
  },
  set completionError(value: { code?: string; message: string } | null) {
    completionError = value
  },
  get modelCapabilities(): ModelCapability[] {
    return modelCapabilities
  },
  set modelCapabilities(value: ModelCapability[]) {
    modelCapabilities = value
  },
  get groupCapabilities(): Record<string, ModelCapability[]> {
    return groupCapabilities
  },
  set groupCapabilities(value: Record<string, ModelCapability[]>) {
    groupCapabilities = value
  },
  get preference(): PlaygroundPreference {
    return preference
  },
  set preference(value: PlaygroundPreference) {
    preference = value
  },
}

export function row(id: number, title: string): SavedConversation {
  const document = emptyConversationDocument()
  document.config = { ...document.config, model: 'test-model', stream: false }
  document.draft = `draft ${title}`
  document.titleGeneration = title ? 'manual' : 'awaiting_reply'
  return { id, title, revision: 1, create_time: id, update_time: id, document }
}
// The server's answer for a write against an older revision.
export function conflict() {
  return new AxiosError(
    'This conversation has changed.',
    'ERR_BAD_REQUEST',
    undefined,
    undefined,
    {
      data: { success: false, message: 'This conversation has changed.' },
      status: 409,
      statusText: 'Conflict',
      headers: {},
      config: { headers: new AxiosHeaders() },
    }
  )
}
// The server's answer for a conversation that was deleted.
export function notFound() {
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
/** Registers the fake server around every test of the file. */
export function setupPlaygroundServer() {
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
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    })
    vi.spyOn(pending, 'readPendingConversations').mockResolvedValue([])
    vi.spyOn(pending, 'writePendingConversation').mockResolvedValue()
    vi.spyOn(api, 'get').mockImplementation(
      async (url, config?: ApiRequestConfig) => {
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
              data:
                groupCapabilities[config?.params.group] ?? modelCapabilities,
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
          return {
            data: { success: true, data: ['test-model', 'other-model'] },
          }
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
      }
    )
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
      if (previous.revision !== write.revision) throw conflict()
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
      if (previous.revision !== patch.revision) throw conflict()
      const value = {
        ...previous,
        title: patch.title ?? previous.title,
        document: applyConversationPatch(previous.document, patch),
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
        const payload = body as {
          messages: { role: string; content: string }[]
        }
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
    vi.useRealTimers()
    vi.restoreAllMocks()
  })
}

// Delete confirmations lock their button for DELETE_CONFIRM_DELAY_SECONDS. A
// test installs fake timers before opening the dialog and skips the wait here.
export async function skipDeleteDelay() {
  await act(async () =>
    vi.advanceTimersByTime(DELETE_CONFIRM_DELAY_SECONDS * 1000)
  )
}

export function renderPlayground(search = '?conversation=1') {
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
