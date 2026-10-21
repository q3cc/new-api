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
import { afterEach, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'

import {
  emptyConversationDocument,
  getConversation,
  writeConversation,
} from '../conversations-api'
import {
  isContextLengthError,
  parseContextLimit,
} from '../lib/message/message-error-utils'
import { parseRequestErrorDetails } from '../lib/streaming/request-error-utils'
import { parseStreamErrorDetails } from '../lib/streaming/stream-utils'

afterEach(() => vi.restoreAllMocks())

it.each([
  { code: 'context_length_exceeded', expected: true },
  { code: 'maximum_context_length', expected: true },
  { code: 'context_window_exceeded', expected: true },
  { code: '402', expected: false },
  { code: 'invalid_request_error', expected: false },
  { code: undefined, expected: false },
  { code: null, expected: false },
])(
  'treats the upstream error code $code as an over-long request: $expected',
  ({ code, expected }) => {
    expect(isContextLengthError(code)).toBe(expected)
  }
)

it.each([
  {
    provider: 'OpenAI',
    content:
      "This model's maximum context length is 128000 tokens. However, your messages resulted in 130512 tokens. Please reduce the length of the messages.",
    limit: 128000,
  },
  {
    provider: 'vLLM',
    content:
      "This model's maximum context length is 32,768 tokens. However, you requested 40000 tokens.",
    limit: 32768,
  },
  {
    provider: 'Anthropic',
    content: 'prompt is too long: 210000 tokens > 200000 maximum',
    limit: 200000,
  },
  {
    provider: 'Gemini',
    content:
      'The input token count (1200000) exceeds the maximum number of tokens allowed (1048576).',
    limit: 1048576,
  },
  {
    provider: 'Qwen',
    content: 'Range of input length should be [1, 30720]',
    limit: 30720,
  },
  {
    provider: 'a gateway without a number',
    content: 'Input exceeds the context window of this model',
    limit: undefined,
  },
  {
    provider: 'a Chinese gateway',
    content: '请求失败：上下文长度超出模型限制',
    limit: undefined,
  },
])(
  'recognizes an over-long request from $provider by its text and learns limit $limit',
  ({ content, limit }) => {
    expect(isContextLengthError(undefined, content)).toBe(true)
    expect(parseContextLimit(content)).toBe(limit)
  }
)

it.each([
  'Requests to the ChatCompletions_Create Operation have exceeded token rate limit of your current OpenAI S0 pricing tier.',
  'Rate limit reached on tokens per min (TPM): Limit 30000, Used 29000.',
  'You exceeded your current quota, please check your plan and billing details.',
  'Invalid API key provided',
  'The model `gpt-9` does not exist',
])('does not offer compression for an unrelated error: %s', (content) => {
  expect(isContextLengthError(undefined, content)).toBe(false)
})

it.each([
  { content: 'maximum context length is 512 tokens', limit: undefined },
  { content: 'maximum context length is 99999999 tokens', limit: undefined },
  { content: undefined, limit: undefined },
])(
  'ignores an implausible or missing context limit: $content',
  ({ content, limit }) => {
    expect(parseContextLimit(content)).toBe(limit)
  }
)

it.each([
  { code: 402, expected: '402' },
  { code: 0, expected: '0' },
  { code: 'model_price_error', expected: 'model_price_error' },
  { code: null, expected: undefined },
  { code: { status: 503 }, expected: undefined },
  { code: true, expected: undefined },
])(
  'normalizes upstream error code $code before it enters a conversation',
  ({ code, expected }) => {
    const payload = { error: { code, message: 'Request was rejected' } }
    const streamed = parseStreamErrorDetails(JSON.stringify(payload))
    const requested = parseRequestErrorDetails({
      message: 'Request failed with status code 402',
      response: { data: payload },
    })

    expect(streamed).toEqual({
      errorCode: expected,
      errorMessage: payload.error.message,
    })
    expect(requested).toEqual({
      errorCode: expected,
      errorMessage: payload.error.message,
    })
  }
)

it('loads and resaves every message when historical errors contain numeric or malformed codes', async () => {
  const messages = Array.from({ length: 20 }, (_, index) => ({
    key: `message-${index}`,
    from: 'assistant',
    status: 'error',
    versions: [
      { id: `version-${index}`, content: `Preserved content ${index}` },
    ],
    errorCode: index === 1 || index === 11 ? 402 : 'model_price_error',
    reasoning: { content: `Preserved reasoning ${index}`, duration: 2 },
  }))
  const document = {
    ...emptyConversationDocument(),
    messages: [
      ...messages.slice(0, 19),
      { ...messages[19], errorCode: { status: 503 } },
    ],
    draft: 'Unsaved draft',
  }
  const stored = {
    id: 41,
    title: 'Existing conversation',
    revision: 3,
    create_time: 1,
    update_time: 2,
    document,
  }
  vi.spyOn(api, 'get').mockResolvedValue({
    data: { success: true, data: stored },
  })
  const put = vi.spyOn(api, 'put').mockImplementation(async (_url, body) => ({
    data: {
      success: true,
      data: { ...stored, ...JSON.parse(body as string), revision: 4 },
    },
  }))

  const loaded = await getConversation(41)
  expect(loaded.document.messages).toHaveLength(20)
  expect(loaded.document.messages[1].errorCode).toBe('402')
  expect(loaded.document.messages[11].errorCode).toBe('402')
  expect(loaded.document.messages[19].errorCode).toBeUndefined()
  expect(
    loaded.document.messages.map(({ versions, reasoning }) => ({
      versions,
      reasoning,
    }))
  ).toEqual(
    document.messages.map(({ versions, reasoning }) => ({
      versions,
      reasoning,
    }))
  )
  expect(loaded.document.draft).toBe(document.draft)

  const saved = await writeConversation(41, {
    operation_id: 'resave-errors-001',
    revision: loaded.revision,
    title: loaded.title,
    document: loaded.document,
  })
  expect(put).toHaveBeenCalledOnce()
  // The document was just sent; only the saved metadata is asked back.
  expect(put.mock.calls[0][2]).toMatchObject({ params: { return: 'meta' } })
  expect(JSON.parse(put.mock.calls[0][1] as string).document).toEqual(
    loaded.document
  )
  expect(saved).toEqual({
    id: 41,
    title: loaded.title,
    revision: 4,
    create_time: loaded.create_time,
    update_time: loaded.update_time,
  })
})
