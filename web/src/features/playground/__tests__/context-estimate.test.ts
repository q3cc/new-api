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
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'

import { clearContextEstimateCache, estimateContext } from '../compression-api'
import type { ChatCompletionMessage } from '../types'

// Mirrors the server: 3 per request plus, per message, 3 and its length.
function serverCount(messages: ChatCompletionMessage[]) {
  const message_tokens = messages.map(
    (message) => 3 + String(message.content).length
  )
  return {
    input_tokens: 3 + message_tokens.reduce((sum, count) => sum + count, 0),
    message_tokens,
  }
}

function sentMessages(call: number) {
  const body = vi.mocked(api.post).mock.calls[call][1] as {
    messages: ChatCompletionMessage[]
  }
  return body.messages
}

const history: ChatCompletionMessage[] = [
  { role: 'user', content: 'first question' },
  { role: 'assistant', content: 'first answer' },
]

beforeEach(() => {
  clearContextEstimateCache()
  vi.spyOn(api, 'post').mockImplementation(async (_url, body) => ({
    data: {
      success: true,
      data: serverCount(
        (body as { messages: ChatCompletionMessage[] }).messages
      ),
    },
  }))
})
afterEach(() => vi.restoreAllMocks())

it('uploads only messages it has not counted before and keeps the server total', async () => {
  await estimateContext('gpt-4o', 'default', history)
  const draft: ChatCompletionMessage = { role: 'user', content: 'a new draft' }

  const estimate = await estimateContext('gpt-4o', 'default', [
    ...history,
    draft,
  ])

  expect(api.post).toHaveBeenCalledTimes(2)
  expect(sentMessages(1)).toEqual([draft])
  expect(estimate).toEqual(serverCount([...history, draft]))
})

it('answers from the cache without a request when every message is known', async () => {
  await estimateContext('gpt-4o', 'default', history)

  const estimate = await estimateContext('gpt-4o', 'default', history)

  expect(api.post).toHaveBeenCalledTimes(1)
  expect(estimate).toEqual(serverCount(history))
})

it('counts per model and sends a repeated message once', async () => {
  const repeated = [history[0], history[0]]
  const estimate = await estimateContext('gpt-4o', 'default', repeated)
  expect(sentMessages(0)).toEqual([history[0]])
  expect(estimate).toEqual(serverCount(repeated))

  await estimateContext('other-model', 'default', [history[0]])
  expect(api.post).toHaveBeenCalledTimes(2)
})

it('keeps exact counts for a single request larger than the cache', async () => {
  const many = Array.from(
    { length: 600 },
    (_, index): ChatCompletionMessage => ({
      role: index % 2 ? 'assistant' : 'user',
      content: `message ${index}`,
    })
  )

  expect(await estimateContext('gpt-4o', 'default', many)).toEqual(
    serverCount(many)
  )
})
