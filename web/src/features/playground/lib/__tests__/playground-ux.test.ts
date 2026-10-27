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
import { describe, expect, it } from 'vitest'

import {
  DEFAULT_CONFIG,
  DEFAULT_PARAMETER_ENABLED,
  ERROR_MESSAGES,
} from '../../constants'
import type { Message } from '../../types'
import { exportConversation } from '../conversation-export'
import { withdrawUnsavedQuestion } from '../message/conversation-message-utils'
import { updateAssistantMessageWithError } from '../message/message-update-utils'
import { toChatMessages } from '../message/message-utils'
import {
  normalizeParameterNumberValue,
  PLAYGROUND_PARAMETER_CONTROLS,
} from '../parameters/playground-parameters'
import {
  parseStreamErrorDetails,
  parseStreamMessage,
} from '../streaming/stream-utils'

function user(key: string, content: string): Message {
  return { key, from: 'user', versions: [{ id: `${key}-v`, content }] }
}

describe('stream errors', () => {
  it('reports a lost connection as a network failure', () => {
    expect(parseStreamErrorDetails(undefined, 0).errorMessage).toBe(
      ERROR_MESSAGES.NETWORK_ERROR
    )
    expect(parseStreamErrorDetails('', 0).errorMessage).toBe(
      ERROR_MESSAGES.NETWORK_ERROR
    )
    expect(
      parseStreamErrorDetails('{"error":{"message":"HTTP 429"}}', 429)
    ).toEqual({ errorCode: undefined, errorMessage: 'HTTP 429' })
  })

  it('ignores chunks that are not shaped like completions', () => {
    expect(parseStreamMessage('{"choices":"nope"}').updates).toEqual([])
    expect(
      parseStreamMessage('{"choices":[{"delta":{"content":"hi"}}]}').updates
    ).toEqual([{ type: 'content', chunk: 'hi' }])
    expect(
      parseStreamMessage('{"error":{"code":7,"message":"boom"}}').error
    ).toEqual({ errorCode: '7', errorMessage: 'boom' })
  })

  it('does not repeat the title when the error already carries it', () => {
    const loading: Message = {
      key: 'a',
      from: 'assistant',
      status: 'loading',
      versions: [{ id: 'v', content: '' }],
    }
    const title = 'Request error occurred'
    const [plain] = updateAssistantMessageWithError(
      [loading],
      title,
      undefined,
      title
    )
    expect(plain.errorMessage).toBe(title)
    const [prefixed] = updateAssistantMessageWithError(
      [loading],
      `${title}: HTTP 500`,
      undefined,
      title
    )
    expect(prefixed.errorMessage).toBe(`${title}: HTTP 500`)
    const [titled] = updateAssistantMessageWithError(
      [loading],
      'HTTP 500',
      undefined,
      title
    )
    expect(titled.errorMessage).toBe(`${title}: HTTP 500`)
  })
})

describe('withdrawing an unsaved question', () => {
  it('takes back a question the server never received and keeps everything else', () => {
    const saved = [user('q1', 'earlier')]
    const pending: Message = {
      key: 'a2',
      from: 'assistant',
      status: 'loading',
      versions: [{ id: 'v', content: '' }],
    }
    const result = withdrawUnsavedQuestion(
      [...saved, user('q2', 'unsent'), pending],
      saved
    )
    expect(result?.text).toBe('unsent')
    expect(result?.messages.map((m) => m.key)).toEqual(['q1'])
  })

  it('leaves a regenerated or edited reply alone', () => {
    const question = user('q1', 'asked')
    const reply: Message = {
      key: 'a1',
      from: 'assistant',
      status: 'loading',
      versions: [
        { id: 'old', content: 'first', state: { status: 'complete' } },
        { id: 'new', content: '' },
      ],
      selectedVersionId: 'new',
    }
    expect(
      withdrawUnsavedQuestion([question, reply], [question, reply])
    ).toBeNull()
    expect(withdrawUnsavedQuestion([question], [question])).toBeNull()
  })
})

describe('parameters', () => {
  it('fall back to the default instead of zero and allow the full provider ranges', () => {
    expect(normalizeParameterNumberValue('temperature', '')).toBe(
      DEFAULT_CONFIG.temperature
    )
    expect(normalizeParameterNumberValue('max_tokens', '')).toBe(
      DEFAULT_CONFIG.max_tokens
    )
    expect(normalizeParameterNumberValue('seed', '')).toBeNull()
    expect(normalizeParameterNumberValue('temperature', '2')).toBe(2)
    expect(normalizeParameterNumberValue('temperature', '0')).toBe(0)
    expect(normalizeParameterNumberValue('top_p', '0')).toBe(0)
    expect(normalizeParameterNumberValue('max_tokens', '0')).toBe(1)
    const temperature = PLAYGROUND_PARAMETER_CONTROLS.find(
      (c) => c.key === 'temperature'
    )
    expect(temperature).toMatchObject({ min: 0, max: 2 })
  })
})

describe('request messages', () => {
  it('converts the same messages for requests and estimates', () => {
    const failed: Message = {
      key: 'f',
      from: 'assistant',
      status: 'error',
      errorMessage: 'x',
      versions: [{ id: 'v', content: 'partial' }],
    }
    expect(toChatMessages([user('q', 'hello'), failed])).toEqual([
      { role: 'user', content: 'hello' },
    ])
  })
})

describe('export', () => {
  it('keeps the server creation time and marks interrupted replies in Markdown', () => {
    const conversation = {
      id: 1,
      title: 'Export',
      revision: 1,
      create_time: 1700000000000,
      update_time: 1700000000000,
      document: {
        messages: [
          user('q', 'question'),
          {
            key: 'a',
            from: 'assistant' as const,
            status: 'interrupted' as const,
            versions: [{ id: 'v', content: 'half an answer' }],
          },
        ],
        config: { ...DEFAULT_CONFIG },
        parameterEnabled: { ...DEFAULT_PARAMETER_ENABLED },
        draft: '',
      },
    }
    const exportedAt = new Date('2026-01-01T00:00:00Z')
    const json = JSON.parse(
      exportConversation(conversation, 'json', exportedAt).content
    )
    expect(json['chat-sessions-list'][0].createdAt).toBe(1700000000000)
    const markdown = exportConversation(conversation, 'md', exportedAt).content
    expect(markdown).toContain(
      'half an answer\n\n_(generation was interrupted)_'
    )
  })
})
