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
import { afterEach, assert, beforeEach, expect, it, vi } from 'vitest'

import * as api from '../api'
import * as compressionApi from '../compression-api'
import {
  emptyConversationDocument,
  parseConversation,
} from '../conversations-api'
import {
  compressContext,
  compressionBoundary,
  compressionSourceHash,
  contextMessages,
  inputBudget,
  shouldCompress,
  validCompression,
} from '../lib/context-compression'
import { createRegeneratedMessages } from '../lib/message/conversation-message-utils'
import { applyChatCompletionResponse } from '../lib/message/message-streaming-utils'
import { updateAssistantMessageWithError } from '../lib/message/message-update-utils'
import {
  getMessageContent,
  selectMessageVersion,
} from '../lib/message/message-utils'
import type { Message } from '../types'

const capability: compressionApi.ModelCapability = {
  model: 'gpt-4o',
  context_window: 128000,
  input_limit: 0,
  output_limit: 16384,
  text_generation: true,
  compression_warning: false,
}
function transcript() {
  const document = emptyConversationDocument()
  document.config.model = 'gpt-4o'
  document.config.group = 'default'
  document.messages = Array.from(
    { length: 10 },
    (_, index): Message => ({
      key: `m${index}`,
      from: index % 2 ? 'assistant' : 'user',
      status: 'complete',
      versions: [
        {
          id: `v${index}`,
          content: `message ${index} ${'long facts '.repeat(100)}`,
        },
      ],
    })
  )
  return document
}
beforeEach(() => {
  vi.spyOn(compressionApi, 'estimateContext').mockImplementation(
    async (_model, _group, messages, signal) => {
      signal?.throwIfAborted()
      const message_tokens = messages.map(
        (message) => 3 + Math.ceil([...String(message.content)].length / 4)
      )
      return {
        input_tokens: 3 + message_tokens.reduce((a, b) => a + b, 0),
        message_tokens,
        estimated: true,
      }
    }
  )
  vi.spyOn(api, 'sendChatCompletion').mockResolvedValue({
    id: 'summary',
    object: 'chat.completion',
    created: 1,
    model: 'gpt-4o',
    choices: [
      {
        index: 0,
        finish_reason: 'stop',
        message: { role: 'assistant', content: 'Facts and unfinished tasks.' },
      },
    ],
  })
})
afterEach(() => vi.restoreAllMocks())

it('keeps three complete turns and the pending input, with total and input-only budgets', () => {
  const document = transcript()
  document.messages.push({
    key: 'pending',
    from: 'user',
    versions: [{ id: 'pending', content: 'next question' }],
  })
  expect(compressionBoundary(document.messages)).toBe(3)
  expect(inputBudget(capability, undefined, 4096)).toBe(123904)
  expect(inputBudget(capability, 16000, 8000)).toBe(8000)
  expect(inputBudget(capability, 500000, 4096)).toBe(123904)
  expect(
    inputBudget(
      { ...capability, context_window: 0, input_limit: 1048576 },
      undefined,
      4096
    )
  ).toBe(1048576)
  expect(
    inputBudget({ ...capability, context_window: 0 }, undefined, 4096)
  ).toBe(0)
  expect(shouldCompress(document, 799, 1000)).toBe(false)
  expect(shouldCompress(document, 800, 1000)).toBe(true)
})

it('preserves originals, system instructions, image messages and invalidates edited source', async () => {
  const document = transcript()
  document.messages.unshift({
    key: 'system',
    from: 'system',
    versions: [{ id: 'system', content: 'Original instructions' }],
  })
  document.messages[1] = {
    ...document.messages[1],
    versions: [
      { id: 'image', content: '![image](https://example.com/image.png)' },
    ],
  }
  const original = structuredClone(document.messages)
  document.compression = await compressContext({
    document,
    capability,
    signal: new AbortController().signal,
    onProgress: vi.fn(),
  })
  const context = contextMessages(document)
  expect(context.map((message) => message.key)).toEqual([
    'system',
    'm0',
    `summary-${document.compression.createdAt}`,
    'm4',
    'm5',
    'm6',
    'm7',
    'm8',
    'm9',
  ])
  expect(document.messages).toEqual(original)
  expect(shouldCompress(document, 900, 1000)).toBe(false)
  document.messages[2] = {
    ...document.messages[2],
    versions: [{ id: 'edited', content: 'Changed fact' }],
  }
  expect(validCompression(document)).toBeUndefined()
  expect(contextMessages(document)).toEqual(document.messages)
})

it('splits long Unicode text and merges summaries without modifying generation parameters', async () => {
  const document = transcript()
  document.contextLimits = { 'gpt-4o': 6500 }
  document.config.model = 'gpt-4o-mini'
  document.compressionSettings = {
    model: 'gpt-4o',
    group: 'DSS',
    automatic: true,
  }
  document.config.max_tokens = 1200
  document.messages[0].versions[0].content = '😀中文'.repeat(8000)
  const progress = vi.fn()
  const summary = await compressContext({
    document,
    capability,
    signal: new AbortController().signal,
    onProgress: progress,
  })
  expect(summary.summary).toBe('Facts and unfinished tasks.')
  expect(api.sendChatCompletion).toHaveBeenCalledTimes(
    progress.mock.calls.at(-1)?.[0]
  )
  expect(vi.mocked(api.sendChatCompletion).mock.calls.length).toBeGreaterThan(2)
  for (const [request] of vi.mocked(api.sendChatCompletion).mock.calls) {
    expect(request).toMatchObject({
      model: 'gpt-4o',
      group: 'DSS',
      max_tokens: 4096,
      stream: false,
    })
    expect(request.temperature).toBeUndefined()
    for (const message of request.messages) {
      expect(String(message.content)).not.toMatch(
        /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/
      )
    }
  }
  expect(document.config.max_tokens).not.toBe(4096)
  const estimates = vi.mocked(compressionApi.estimateContext).mock.calls
  expect(
    estimates
      .filter(([model]) => model === 'gpt-4o')
      .every(([, group]) => group === 'DSS')
  ).toBe(true)
  expect(estimates.slice(-2).map(([model, group]) => [model, group])).toEqual([
    ['gpt-4o-mini', 'default'],
    ['gpt-4o-mini', 'default'],
  ])
  expect(summary.group).toBe('DSS')
})

it.each(['', 'length', 'expansion', 'error'])(
  'rejects invalid compression: %s',
  async (failure) => {
    const document = transcript()
    const original = structuredClone(document)
    const contents: Record<string, string> = {
      '': '',
      expansion: 'x'.repeat(10000),
      length: 'Partial summary',
    }
    if (failure === 'error') {
      vi.mocked(api.sendChatCompletion).mockRejectedValue(new Error('402'))
    } else {
      vi.mocked(api.sendChatCompletion).mockResolvedValue({
        id: '',
        object: '',
        created: 1,
        model: 'gpt-4o',
        choices: [
          {
            index: 0,
            finish_reason: failure === 'length' ? 'length' : 'stop',
            message: {
              role: 'assistant',
              content: contents[failure],
            },
          },
        ],
      })
    }
    await expect(
      compressContext({
        document,
        capability,
        signal: new AbortController().signal,
        onProgress: vi.fn(),
      })
    ).rejects.toThrow()
    expect(document).toEqual(original)
    expect(api.sendChatCompletion).toHaveBeenCalledTimes(1)
  }
)

it('aborts before a paid request and avoids re-compressing the same boundary', async () => {
  const document = transcript()
  const controller = new AbortController()
  controller.abort()
  await expect(
    compressContext({
      document,
      capability,
      signal: controller.signal,
      onProgress: vi.fn(),
    })
  ).rejects.toThrow()
  expect(api.sendChatCompletion).not.toHaveBeenCalled()
  document.compression = {
    summary: 'Existing summary',
    boundary: 'm3',
    sourceHash: compressionSourceHash(document.messages.slice(0, 4)),
    model: 'gpt-4o',
    createdAt: 1,
  }
  await expect(
    compressContext({
      document,
      capability,
      signal: new AbortController().signal,
      onProgress: vi.fn(),
    })
  ).rejects.toThrow('Not enough messages')
  expect(api.sendChatCompletion).not.toHaveBeenCalled()
})

it('retains successful replies, switches their metadata, excludes failed retries, and saves selection', () => {
  const document = transcript()
  const previous = document.messages.at(-1)
  assert(previous)
  previous.reasoning = { content: 'Old reasoning', duration: 1 }
  previous.durationMs = 123
  const regenerated = createRegeneratedMessages(document.messages, previous.key)
  assert(regenerated)
  const loading = regenerated.at(-1)
  assert(loading)
  expect(loading.versions).toHaveLength(2)
  expect(getMessageContent(loading)).toBe('')
  const completed = applyChatCompletionResponse(loading, {
    id: '',
    object: '',
    created: 1,
    model: '',
    choices: [
      {
        index: 0,
        finish_reason: 'stop',
        message: {
          role: 'assistant',
          content: 'New answer',
          reasoning_content: 'New reasoning',
        },
      },
    ],
  })
  assert(completed)
  const old = selectMessageVersion(completed, previous.versions[0].id)
  expect(getMessageContent(old)).toBe(getMessageContent(previous))
  expect(old.reasoning?.content).toBe('Old reasoning')
  expect(old.durationMs).toBe(123)
  assert(completed.selectedVersionId)
  const selected = selectMessageVersion(old, completed.selectedVersionId)
  expect(getMessageContent(selected)).toBe('New answer')
  expect(selected.reasoning?.content).toBe('New reasoning')
  const failed = updateAssistantMessageWithError(
    [loading],
    'Payment required',
    '402'
  )[0]
  expect(failed.versions).toHaveLength(1)
  expect(getMessageContent(failed)).toBe(getMessageContent(previous))
  expect(failed.status).toBe('complete')
  const retryError = createRegeneratedMessages(
    [{ ...previous, status: 'error' }],
    previous.key
  )?.at(-1)
  assert(retryError)
  expect(retryError.versions).toHaveLength(1)
  document.messages[9] = old
  const restored = parseConversation({
    id: 1,
    title: '',
    revision: 1,
    create_time: 1,
    update_time: 1,
    document,
  })
  expect(restored.document.messages[9]).toEqual(old)
  const hash = compressionSourceHash([old])
  expect(compressionSourceHash([selected])).not.toBe(hash)
})
