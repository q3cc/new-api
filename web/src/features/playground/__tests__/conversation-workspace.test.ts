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
import { waitFor } from '@testing-library/react'
import { AxiosError } from 'axios'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'
import { useAuthStore } from '@/stores/auth-store'

import * as conversationsApi from '../conversations-api'
import {
  emptyConversationDocument,
  type ConversationWrite,
  type SavedConversation,
} from '../conversations-api'
import { ConversationWorkspace } from '../lib/conversation-workspace'
import * as pending from '../lib/storage/pending-conversations'
import type { ChatCompletionRequest } from '../types'

let rows: Map<number, SavedConversation>
let cached: Map<string, pending.PendingConversation>
let workspaces: ConversationWorkspace[]
let failSave: boolean
let loseResponse: boolean
let failImport: boolean
let writes: ConversationWrite[]
const operationResults = new Map<string, SavedConversation>()
let titleCalls: {
  payload: ChatCompletionRequest
  signal?: AbortSignal
  finish: (title: string) => void
  fail: () => void
}[]

function setOwner(id: number) {
  useAuthStore.getState().auth.setUser({ id, username: 'owner', role: 1 })
}
function message(
  content: string,
  status: 'complete' | 'streaming' = 'complete'
) {
  return {
    key: 'message',
    from: 'assistant' as const,
    status,
    versions: [{ id: 'v1', content }],
  }
}
function workspace(owner = 1) {
  const result = new ConversationWorkspace(owner, () => {})
  workspaces.push(result)
  result.attach()
  return result
}
function responseError(status: number) {
  return Object.assign(new AxiosError('save rejected'), {
    response: {
      status,
      headers: {},
      data: { success: false, message: 'save rejected' },
    },
  })
}
beforeEach(() => {
  localStorage.clear()
  setOwner(1)
  rows = new Map()
  cached = new Map()
  workspaces = []
  writes = []
  titleCalls = []
  failSave = loseResponse = failImport = false
  operationResults.clear()
  vi.spyOn(conversationsApi, 'importConversation').mockImplementation(
    async () => {
      if (failImport) throw new Error('Import unavailable')
      return { conversation_id: 1, deleted: !rows.has(1) }
    }
  )
  vi.spyOn(pending, 'readPendingConversations').mockImplementation(
    async (owner) =>
      [...cached.values()]
        .filter((value) => value.owner === owner)
        .map((value) => structuredClone(value))
  )
  vi.spyOn(pending, 'writePendingConversation').mockImplementation(
    async (owner, key, value) => {
      const cacheKey = `${owner}:${key}`
      if (value) cached.set(cacheKey, structuredClone(value))
      else cached.delete(cacheKey)
    }
  )
  vi.spyOn(api, 'get').mockImplementation(async (url) => {
    const row = rows.get(Number(url?.split('/').at(-1)))
    if (!row) throw responseError(404)
    return { data: { success: true, data: structuredClone(row) } }
  })
  vi.spyOn(api, 'post').mockImplementation(async (url, body, config) => {
    if (url === '/pg/chat/completions') {
      return new Promise((resolve, reject) =>
        titleCalls.push({
          payload: body as ChatCompletionRequest,
          signal: config?.signal as AbortSignal | undefined,
          finish: (title) =>
            resolve({ data: { choices: [{ message: { content: title } }] } }),
          fail: () => reject(new Error('Unavailable')),
        })
      )
    }
    if (url?.endsWith('/import')) {
      if (failImport) throw new Error('Import unavailable')
      return {
        data: {
          success: true,
          data: { conversation_id: 1, deleted: !rows.has(1) },
        },
      }
    }
    const write = JSON.parse(body as string) as ConversationWrite
    writes.push(structuredClone(write))
    if (failSave) throw new Error('Offline')
    let row = operationResults.get(write.operation_id)
    if (!row) {
      row = {
        id: rows.size + 1,
        revision: 1,
        title: write.title,
        document: write.document,
        create_time: 1,
        update_time: 1,
      }
      rows.set(row.id, structuredClone(row))
      operationResults.set(write.operation_id, structuredClone(row))
    }
    return { data: { success: true, data: structuredClone(row) } }
  })
  vi.spyOn(api, 'put').mockImplementation(async (url, body) => {
    const write = JSON.parse(body as string) as ConversationWrite
    writes.push(structuredClone(write))
    if (failSave) throw new Error('Offline')
    const id = Number(url?.split('/').at(-1))
    const previous = rows.get(id)
    if (!previous) throw responseError(404)
    let row = operationResults.get(write.operation_id)
    if (!row) {
      if (previous.revision !== write.revision) throw responseError(409)
      row = {
        ...previous,
        title: write.title,
        document: write.document,
        revision: previous.revision + 1,
      }
      rows.set(id, structuredClone(row))
      operationResults.set(write.operation_id, structuredClone(row))
    }
    if (loseResponse) {
      loseResponse = false
      throw new Error('Response lost')
    }
    return { data: { success: true, data: structuredClone(row) } }
  })
  vi.spyOn(api, 'delete').mockImplementation(async (url) => {
    rows.delete(Number(url?.split('/').at(-1)))
    return { data: { success: true, data: null } }
  })
})
afterEach(() => {
  for (const item of workspaces) item.dispose()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

it('keeps messages, drafts and configuration separate and restores them from the server', async () => {
  const client = workspace()
  await waitFor(() => expect(client.getSnapshot().ready).toBe(true))
  const first = (await client.create(emptyConversationDocument())) ?? ''
  const second = (await client.create(emptyConversationDocument())) ?? ''
  client.update(first, (row) => ({
    ...row,
    document: {
      ...row.document,
      draft: 'draft A',
      config: { ...row.document.config, group: 'DSS' },
      messages: [message('reply A')],
    },
  }))
  client.update(second, (row) => ({
    ...row,
    document: {
      ...row.document,
      draft: 'draft B',
      messages: [message('reply B')],
    },
  }))
  await client.flush(first)
  await client.flush(second)
  expect(rows.get(1)?.document.messages[0].versions[0].content).toBe('reply A')
  expect(rows.get(2)?.document.messages[0].versions[0].content).toBe('reply B')
  expect(cached.size).toBe(0)
  const anotherDevice = workspace()
  await anotherDevice.open(1)
  const restored = Object.values(anotherDevice.getSnapshot().entries)[0].row
    .document
  expect(restored.config.group).toBe('DSS')
  expect(restored.draft).toBe('draft A')
})

it('retains offline edits and retries a lost response with the same operation ID', async () => {
  const client = workspace()
  const key = (await client.create(emptyConversationDocument())) ?? ''
  client.update(key, (row) => ({
    ...row,
    document: { ...row.document, draft: 'must survive' },
  }))
  failSave = true
  expect(await client.flush(key)).toBe(false)
  expect([...cached.values()][0].row.document.draft).toBe('must survive')
  const operation = writes.at(-1)?.operation_id
  failSave = false
  loseResponse = true
  expect(await client.flush(key)).toBe(false)
  expect(rows.get(1)?.revision).toBe(2)
  expect(await client.flush(key)).toBe(true)
  expect(writes.at(-1)?.operation_id).toBe(operation)
  expect(rows.get(1)?.revision).toBe(2)
  expect(cached.size).toBe(0)
})

it('joins concurrent opens and caches edits before the next scheduled server save', async () => {
  const first = workspace()
  await first.create(emptyConversationDocument())
  const second = workspace()
  const [a, b] = await Promise.all([second.open(1), second.open(1)])
  expect(a).toBe(b)
  expect(Object.values(second.getSnapshot().entries)).toHaveLength(1)
  second.update(a ?? '', (row) => ({
    ...row,
    document: { ...row.document, draft: 'just typed' },
  }))
  await waitFor(() =>
    expect(
      [...cached.values()].some(
        (item) => item.row.document.draft === 'just typed'
      )
    ).toBe(true)
  )
  expect(rows.get(1)?.document.draft).toBe('')
})

it('backs off after rate limiting and preserves a single pending operation', async () => {
  vi.useFakeTimers()
  const client = workspace()
  const key = (await client.create(emptyConversationDocument())) ?? ''
  client.update(key, (row) => ({
    ...row,
    document: { ...row.document, draft: 'rate limited' },
  }))
  const error = responseError(429)
  if (error.response) error.response.headers['retry-after'] = '3'
  vi.mocked(api.put).mockRejectedValueOnce(error)
  expect(await client.flush(key)).toBe(false)
  const operation = client.getSnapshot().entries[key].pending?.operation_id
  expect(await client.flush(key)).toBe(false)
  expect(rows.get(1)?.revision).toBe(1)
  await vi.advanceTimersByTimeAsync(4000)
  expect(rows.get(1)?.document.draft).toBe('rate limited')
  expect(writes.at(-1)?.operation_id).toBe(operation)
  expect(cached.size).toBe(0)
})

it('reports concurrent edits without overwriting the newer server conversation', async () => {
  const first = workspace()
  const firstKey = (await first.create(emptyConversationDocument())) ?? ''
  const second = workspace()
  const secondKey = (await second.open(1)) ?? ''
  first.update(firstKey, (row) => ({
    ...row,
    document: { ...row.document, draft: 'newer' },
  }))
  await first.flush(firstKey)
  second.update(secondKey, (row) => ({
    ...row,
    document: { ...row.document, draft: 'mine' },
  }))
  expect(await second.flush(secondKey)).toBe(false)
  expect(second.getSnapshot().entries[secondKey].error).toBeInstanceOf(
    AxiosError
  )
  expect(rows.get(1)?.document.draft).toBe('newer')
  const copied =
    (await second.create(
      second.getSnapshot().entries[secondKey].row.document
    )) ?? ''
  expect(second.getSnapshot().entries[copied].row.id).toBe(2)
  expect(rows.get(2)?.document.draft).toBe('mine')
})

it('does not truncate long legacy records and removes local originals only after import succeeds', async () => {
  const raw = JSON.stringify({
    version: 1,
    data: Array.from({ length: 105 }, (_, index) => ({
      ...message('x'.repeat(41000)),
      key: String(index),
    })),
  })
  localStorage.setItem('playground_messages', raw)
  failImport = true
  const client = workspace()
  await waitFor(() => expect(client.getSnapshot().ready).toBe(true))
  expect(localStorage.getItem('playground_messages')).toBe(raw)
  expect(client.getSnapshot().migrationError).toBeTruthy()
  failImport = false
  await client.migrate()
  const imported = vi
    .mocked(conversationsApi.importConversation)
    .mock.calls.at(-1)?.[0]
  expect(imported?.messages).toBe(raw)
  expect(localStorage.getItem('playground_messages')).toBeNull()
})

it('never clears changed legacy content and never imports a failed owner migration into another account', async () => {
  const raw = JSON.stringify([message('original')])
  localStorage.setItem('playground_messages', raw)
  const source = pending.readLegacySource(1)
  localStorage.setItem(
    'playground_messages',
    JSON.stringify([message('newer')])
  )
  expect(source?.messages).toBe(raw)
  if (source) pending.clearImportedSource(1, source)
  expect(localStorage.getItem('playground_messages')).toContain('newer')
  expect(pending.readLegacySource(2)).toBeNull()
})

it('stops retrying when the logged-in owner changes and keeps the original owner cache', async () => {
  const client = workspace()
  const key = (await client.create(emptyConversationDocument())) ?? ''
  client.update(key, (row) => ({
    ...row,
    document: { ...row.document, draft: 'account A' },
  }))
  failSave = true
  await client.flush(key)
  const count = writes.length
  setOwner(2)
  expect(await client.flush(key)).toBe(false)
  expect(writes).toHaveLength(count)
  expect(
    [...cached.values()].some(
      (value) => value.owner === 1 && value.row.document.draft === 'account A'
    )
  ).toBe(true)
})

it('restores unfinished replies as interrupted without deleting any content or versions', async () => {
  const doc = emptyConversationDocument()
  doc.messages = [message('partial reply', 'streaming')]
  const client = workspace()
  const key = (await client.create(doc)) ?? ''
  client.dispose()
  const restored = workspace()
  const loaded = (await restored.open(1)) ?? ''
  expect(
    restored.getSnapshot().entries[loaded].row.document.messages[0]
  ).toMatchObject({
    status: 'interrupted',
    versions: [{ id: 'v1', content: 'partial reply' }],
  })
  expect(rows.get(1)?.document.messages[0].status).toBe('streaming')
  expect(
    client.getSnapshot().entries[key].row.document.messages[0].versions[0]
      .content
  ).toBe('partial reply')
})

it('deletes only the selected conversation and cannot save it again', async () => {
  const client = workspace()
  const first = (await client.create(emptyConversationDocument())) ?? ''
  const second = (await client.create(emptyConversationDocument())) ?? ''
  await client.remove(first)
  expect(rows.has(1)).toBe(false)
  expect(rows.has(2)).toBe(true)
  expect(client.getSnapshot().entries[second]).toBeDefined()
  expect(await client.flush(first)).toBe(false)
})

it('rejects an oversized write without discarding the pending document', async () => {
  const client = workspace()
  const key = (await client.create(emptyConversationDocument())) ?? ''
  const draft = 'x'.repeat(8 * 1024 * 1024)
  client.update(key, (row) => ({
    ...row,
    document: { ...row.document, draft },
  }))
  expect(await client.flush(key)).toBe(false)
  expect(rows.get(1)?.document.draft).toBe('')
  expect(client.getSnapshot().entries[key].row.document.draft).toBe(draft)
  expect([...cached.values()][0].row.document.draft).toBe(draft)
})

function importedRow(): SavedConversation {
  const document = emptyConversationDocument()
  delete document.titleGeneration
  document.config.model = 'title-model'
  document.config.group = 'DSS'
  document.draft = 'unfinished question'
  document.messages = [
    { ...message('private system instruction'), key: 'system', from: 'system' },
    { ...message('How does routing work?'), key: 'user', from: 'user' },
    message('Routing chooses an available channel.'),
  ]
  return {
    id: 1,
    title: 'Imported conversation',
    revision: 1,
    create_time: 1,
    update_time: 1,
    document,
  }
}

it('summarizes imported history with its own model and group without changing messages or drafts', async () => {
  const original = importedRow()
  original.document.messages[2].versions[0].content = 'A long answer. '.repeat(
    1000
  )
  rows.set(1, structuredClone(original))
  const client = workspace()
  const key = (await client.open(1)) ?? ''
  const task = client.generateTitle(key)
  await waitFor(() => expect(titleCalls).toHaveLength(1))
  expect(rows.get(1)?.document.titleGeneration).toBe('requested')
  expect(titleCalls[0].payload).toMatchObject({
    model: 'title-model',
    group: 'DSS',
    stream: false,
  })
  expect(titleCalls[0].payload.messages[1].content.length).toBeLessThanOrEqual(
    3000
  )
  expect(titleCalls[0].payload.messages[1].content).not.toContain(
    'private system instruction'
  )
  titleCalls[0].finish('<think>hidden reasoning</think>\n“Channel routing”')
  await task
  expect(rows.get(1)?.title).toBe('Channel routing')
  expect(rows.get(1)?.document.messages).toEqual(original.document.messages)
  expect(rows.get(1)?.document.draft).toBe('unfinished question')
  await client.generateTitle(key)
  const other = workspace()
  await other.generateTitle((await other.open(1)) ?? '')
  expect(titleCalls).toHaveLength(1)
})

it('waits for a completed first reply and generates only one automatic title', async () => {
  const client = workspace()
  const document = emptyConversationDocument()
  document.messages = [
    { ...message('Tell me about stars'), key: 'user', from: 'user' },
    message('partial', 'streaming'),
  ]
  const key = (await client.create(document)) ?? ''
  await client.generateTitle(key)
  expect(titleCalls).toHaveLength(0)
  client.update(key, (row) => ({
    ...row,
    document: {
      ...row.document,
      messages: [document.messages[0], message('Stars are luminous.')],
    },
  }))
  const first = client.generateTitle(key)
  await client.generateTitle(key)
  await waitFor(() => expect(titleCalls).toHaveLength(1))
  titleCalls[0].finish('Stars')
  await first
  await client.generateTitle(key)
  expect(rows.get(1)?.title).toBe('Stars')
  expect(titleCalls).toHaveLength(1)
})

it('claims title generation with the saved revision so two devices cannot both charge automatically', async () => {
  rows.set(1, importedRow())
  const first = workspace()
  const second = workspace()
  const a = (await first.open(1)) ?? ''
  const b = (await second.open(1)) ?? ''
  const tasks = [first.generateTitle(a), second.generateTitle(b)]
  await waitFor(() => expect(titleCalls).toHaveLength(1))
  titleCalls[0].finish('Routing')
  await Promise.all(tasks)
  expect(titleCalls).toHaveLength(1)
  expect(rows.get(1)?.title).toBe('Routing')
})

it.each(['failure', 'empty', 'interrupted'])(
  'keeps the original title after %s and requires explicit retry across refresh',
  async (failure) => {
    rows.set(1, importedRow())
    const client = workspace()
    const key = (await client.open(1)) ?? ''
    const task = client.generateTitle(key)
    await waitFor(() => expect(titleCalls).toHaveLength(1))
    if (failure === 'interrupted') client.dispose()
    if (failure === 'failure') titleCalls[0].fail()
    else titleCalls[0].finish('<think>no final title')
    await task
    expect(rows.get(1)?.title).toBe('Imported conversation')
    const next = workspace()
    const nextKey = (await next.open(1)) ?? ''
    await next.generateTitle(nextKey)
    expect(titleCalls).toHaveLength(1)
    const retry = next.generateTitle(nextKey, true)
    await waitFor(() => expect(titleCalls).toHaveLength(2))
    titleCalls[1].finish('Recovered title')
    await retry
    expect(rows.get(1)?.title).toBe('Recovered title')
  }
)

it.each(['rename', 'delete', 'logout', 'clear'])(
  'ignores a delayed title after %s and aborts its request',
  async (action) => {
    rows.set(1, importedRow())
    const client = workspace()
    const key = (await client.open(1)) ?? ''
    const task = client.generateTitle(key)
    await waitFor(() => expect(titleCalls).toHaveLength(1))
    if (action === 'rename') {
      client.rename(key, 'My own title')
      await client.flush(key)
    } else if (action === 'delete') {
      await client.remove(key)
    } else if (action === 'logout') {
      setOwner(2)
    } else {
      client.update(key, (row) => ({
        ...row,
        document: { ...row.document, messages: [] },
      }))
      await client.flush(key)
    }
    expect(titleCalls[0].signal?.aborted).toBe(true)
    titleCalls[0].finish('Late title')
    await task
    expect(rows.get(1)?.title).not.toBe('Late title')
    if (action === 'rename') {
      expect(rows.get(1)?.title).toBe('My own title')
      await client.generateTitle(key)
      expect(titleCalls).toHaveLength(1)
    }
  }
)

it('does not charge for a title when saving the attempt fails', async () => {
  rows.set(1, importedRow())
  const client = workspace()
  const key = (await client.open(1)) ?? ''
  loseResponse = true
  await client.generateTitle(key)
  expect(titleCalls).toHaveLength(0)
  expect(await client.flush(key)).toBe(true)
  await client.generateTitle(key)
  expect(titleCalls).toHaveLength(0)
  expect(rows.get(1)?.title).toBe('Imported conversation')
})

it('keeps concurrent title results in their original conversations and preserves edits made while waiting', async () => {
  rows.set(1, importedRow())
  const second = importedRow()
  second.id = 2
  second.document.config.group = 'GPT'
  second.document.config.model = 'other-model'
  rows.set(2, second)
  const client = workspace()
  const a = (await client.open(1)) ?? ''
  const b = (await client.open(2)) ?? ''
  const firstTask = client.generateTitle(a)
  await waitFor(() => expect(titleCalls).toHaveLength(1))
  const secondTask = client.generateTitle(b)
  await waitFor(() => expect(titleCalls).toHaveLength(2))
  expect(titleCalls[1].payload).toMatchObject({
    group: 'GPT',
    model: 'other-model',
  })
  client.update(a, (row) => ({
    ...row,
    document: { ...row.document, draft: 'typed during title generation' },
  }))
  titleCalls[1].finish('Second topic')
  titleCalls[0].finish('First topic')
  await Promise.all([firstTask, secondTask])
  expect(rows.get(1)?.title).toBe('First topic')
  expect(rows.get(2)?.title).toBe('Second topic')
  expect(rows.get(1)?.document.draft).toBe('typed during title generation')
})
