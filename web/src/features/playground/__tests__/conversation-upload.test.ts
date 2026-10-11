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
import { createHash, webcrypto } from 'node:crypto'

import { AxiosError } from 'axios'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'

import { importConversation, type LegacySource } from '../conversations-api'

const source: LegacySource = {
  messages: '中'.repeat(200000),
  config: null,
  parameter_enabled: null,
}
const chunkSize = 256 * 1024
const bytes = Buffer.from(JSON.stringify(source))
const hash = (data: Uint8Array) =>
  createHash('sha256').update(data).digest('hex')

beforeEach(() => {
  vi.stubGlobal('crypto', webcrypto)
  vi.spyOn(api, 'post').mockResolvedValue({
    data: { success: true, data: { conversation_id: 7, deleted: false } },
  })
})
afterEach(() => vi.unstubAllGlobals())

it('resumes verified chunks, transfers missing chunks concurrently and completes only after acknowledgement', async () => {
  vi.spyOn(api, 'get').mockResolvedValue({
    data: {
      success: true,
      data: { chunks: { 0: hash(bytes.subarray(0, chunkSize)) } },
    },
  })
  const finishes: (() => void)[] = []
  const put = vi.spyOn(api, 'put').mockImplementation(async (_url, body) => {
    const data = body as { index: number; content: string; hash: string }
    expect(hash(Buffer.from(data.content, 'base64'))).toBe(data.hash)
    await new Promise<void>((resolve) => finishes.push(resolve))
    return { data: { success: true, data: null } }
  })
  const progress = vi.fn()
  const task = importConversation(source, undefined, progress)
  await vi.waitFor(() => expect(finishes).toHaveLength(2))
  expect(
    put.mock.calls
      .map((call) => (call[1] as { index: number }).index)
      .sort((a, b) => a - b)
  ).toEqual([1, 2])
  expect(api.post).not.toHaveBeenCalled()
  for (const finish of finishes) finish()
  expect(await task).toEqual({ conversation_id: 7, deleted: false })
  expect(progress.mock.calls.at(-1)?.[0]).toEqual({
    uploaded: bytes.length,
    total: bytes.length,
    phase: 'complete',
  })
})

it('rechecks hashes and resumes after a failed transfer, keeping a completed import idempotent', async () => {
  const chunks: Record<string, string> = {}
  vi.spyOn(api, 'get').mockImplementation(async () => ({
    data: { success: true, data: { chunks: { ...chunks } } },
  }))
  const put = vi.spyOn(api, 'put').mockImplementation(async (_url, body) => {
    const data = body as { index: number; hash: string }
    if (data.index === 1) {
      throw new AxiosError(
        'Request rejected',
        undefined,
        undefined,
        undefined,
        { status: 400 } as never
      )
    }
    chunks[String(data.index)] = data.hash
    return { data: { success: true, data: null } }
  })
  await expect(importConversation(source)).rejects.toThrow('Request rejected')
  expect(api.post).not.toHaveBeenCalled()
  put.mockImplementation(async (_url, body) => {
    const data = body as { index: number; hash: string }
    chunks[String(data.index)] = data.hash
    return { data: { success: true, data: null } }
  })
  const before = put.mock.calls.length
  const missing = [0, 1, 2].filter((index) => !chunks[String(index)])
  await importConversation(source)
  expect(
    put.mock.calls
      .slice(before)
      .map((call) => (call[1] as { index: number }).index)
      .sort((a, b) => a - b)
  ).toEqual(missing)
  vi.mocked(api.get).mockResolvedValue({
    data: {
      success: true,
      data: { chunks: {}, result: { conversation_id: 7, deleted: true } },
    },
  })
  const calls = put.mock.calls.length
  expect(await importConversation(source)).toEqual({
    conversation_id: 7,
    deleted: true,
  })
  expect(put).toHaveBeenCalledTimes(calls)
})

it('rejects oversized records and aborted uploads without issuing new requests', async () => {
  const get = vi.spyOn(api, 'get')
  await expect(
    importConversation({ ...source, messages: 'x'.repeat(8 * 1024 * 1024) })
  ).rejects.toThrow('Conversation exceeds the size limit')
  const controller = new AbortController()
  controller.abort()
  await expect(
    importConversation(source, controller.signal)
  ).rejects.toBeTruthy()
  expect(get).not.toHaveBeenCalled()
})

it('verifies uploads on mobile HTTP origins where Web Crypto is unavailable', async () => {
  vi.stubGlobal('crypto', {})
  const get = vi.spyOn(api, 'get').mockResolvedValue({
    data: {
      success: true,
      data: { chunks: {}, result: { conversation_id: 7, deleted: false } },
    },
  })
  await importConversation(source)
  expect(get.mock.calls[0][0]).toBe(
    `/api/playground/conversations/import/chunks/${hash(bytes)}`
  )
})
