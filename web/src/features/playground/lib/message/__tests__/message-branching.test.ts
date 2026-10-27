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
  emptyConversationDocument,
  parseConversation,
} from '../../../conversations-api'
import type { Message } from '../../../types'
import {
  applyMessageEdit,
  createRegeneratedMessages,
  interruptMessages,
  switchMessageVersion,
} from '../conversation-message-utils'
import { updateAssistantMessageWithError } from '../message-update-utils'
import { getMessageContent } from '../message-utils'

function user(key: string, content: string): Message {
  return { key, from: 'user', versions: [{ id: `${key}-v1`, content }] }
}
function reply(key: string, content: string): Message {
  return {
    key,
    from: 'assistant',
    status: 'complete',
    versions: [{ id: `${key}-v1`, content }],
  }
}
function allKeys(messages: Message[]): string[] {
  return messages.flatMap((message) => [
    message.key,
    ...message.versions.flatMap((version) =>
      allKeys(version.continuation ?? [])
    ),
  ])
}

describe('editing a question', () => {
  it('starts a branch and can return to the original reply and what followed it', () => {
    const messages = [
      user('q1', 'first question'),
      reply('a1', 'first answer'),
      user('q2', 'follow-up'),
      reply('a2', 'follow-up answer'),
    ]
    const edit = applyMessageEdit(messages, 'q1', 'edited question', true)
    expect(edit?.shouldSend).toBe(true)
    const branched = edit?.messages ?? []
    expect(branched).toHaveLength(2)
    expect(getMessageContent(branched[0])).toBe('edited question')
    expect(branched[0].versions).toHaveLength(2)
    expect(branched[0].versions[0].content).toBe('first question')
    expect(branched[0].versions[0].continuation?.map((m) => m.key)).toEqual([
      'a1',
      'q2',
      'a2',
    ])
    expect(branched[1].from).toBe('assistant')
    expect(branched[1].status).toBe('loading')

    const answered = [
      branched[0],
      {
        ...branched[1],
        status: 'complete' as const,
        versions: [{ id: 'new', content: 'new answer' }],
      },
    ]
    const restored = switchMessageVersion(
      answered,
      'q1',
      branched[0].versions[0].id
    )
    expect(restored.map((m) => getMessageContent(m))).toEqual([
      'first question',
      'first answer',
      'follow-up',
      'follow-up answer',
    ])
    expect(restored[0].versions[0].continuation).toBeUndefined()
    expect(restored[0].versions[1].continuation?.map((m) => m.key)).toEqual([
      branched[1].key,
    ])
    expect(new Set(allKeys(restored)).size).toBe(allKeys(restored).length)

    const back = switchMessageVersion(
      restored,
      'q1',
      restored[0].versions[1].id
    )
    expect(back.map((m) => getMessageContent(m))).toEqual([
      'edited question',
      'new answer',
    ])
  })

  it('saves without sending in place', () => {
    const messages = [user('q1', 'typo'), reply('a1', 'answer')]
    const edit = applyMessageEdit(messages, 'q1', 'fixed', false)
    expect(edit?.shouldSend).toBe(false)
    expect(edit?.messages).toHaveLength(2)
    expect(edit?.messages[0].versions).toHaveLength(1)
    expect(getMessageContent(edit?.messages[0] as Message)).toBe('fixed')
  })
})

describe('regenerating a reply', () => {
  it('keeps failed and interrupted versions and the messages that followed the old reply', () => {
    const failed: Message = {
      ...reply('a1', ''),
      status: 'error',
      errorMessage: 'Request error occurred: HTTP 500',
    }
    const messages = [user('q1', 'question'), failed, user('q2', 'later')]
    const regenerated = createRegeneratedMessages(messages, 'a1') ?? []
    expect(regenerated).toHaveLength(2)
    expect(regenerated[1].versions).toHaveLength(2)
    expect(regenerated[1].versions[0].state?.status).toBe('error')
    expect(regenerated[1].versions[0].state?.errorMessage).toContain('HTTP 500')
    expect(regenerated[1].versions[0].continuation?.map((m) => m.key)).toEqual([
      'q2',
    ])
    expect(regenerated[1].status).toBe('loading')
  })

  it('drops only a version that is empty and did not fail', () => {
    const empty: Message = { ...reply('a1', ''), status: 'complete' }
    const regenerated =
      createRegeneratedMessages([user('q1', 'q'), empty], 'a1') ?? []
    expect(regenerated[1].versions).toHaveLength(1)
  })
})

describe('failing and stopping', () => {
  it('keeps the partial text and records the failure beside it', () => {
    const streaming: Message = {
      ...reply('a1', 'partial'),
      status: 'streaming',
      versions: [
        { id: 'old', content: 'earlier answer', state: { status: 'complete' } },
        { id: 'new', content: 'partial' },
      ],
      selectedVersionId: 'new',
    }
    const [failed] = updateAssistantMessageWithError(
      [streaming],
      'HTTP 429',
      '429',
      'Request error occurred'
    )
    expect(failed.versions).toHaveLength(2)
    expect(failed.selectedVersionId).toBe('new')
    expect(getMessageContent(failed)).toBe('partial')
    expect(failed.errorMessage).toBe('Request error occurred: HTTP 429')
    expect(failed.status).toBe('error')
  })

  it('keeps an interrupted reply that has text and returns to the previous version when nothing arrived', () => {
    const withText: Message = { ...reply('a1', 'half'), status: 'streaming' }
    expect(interruptMessages([withText])[0]).toMatchObject({
      status: 'interrupted',
      versions: [{ content: 'half' }],
    })
    const empty: Message = {
      ...reply('a1', ''),
      status: 'loading',
      versions: [
        {
          id: 'old',
          content: 'earlier answer',
          state: { status: 'complete' },
          continuation: [user('q2', 'follow-up')],
        },
        { id: 'new', content: '' },
      ],
      selectedVersionId: 'new',
    }
    const restored = interruptMessages([user('q1', 'q'), empty])
    expect(restored.map((m) => getMessageContent(m))).toEqual([
      'q',
      'earlier answer',
      'follow-up',
    ])
    expect(restored[1].versions).toHaveLength(1)
    expect(restored[1].status).toBe('complete')
  })

  it('interrupts only the requested messages', () => {
    const first: Message = { ...reply('a1', 'one'), status: 'streaming' }
    const second: Message = { ...reply('a2', 'two'), status: 'streaming' }
    const result = interruptMessages([first, second], new Set(['a2']))
    expect(result[0].status).toBe('streaming')
    expect(result[1].status).toBe('interrupted')
  })
})

describe('saved documents', () => {
  it('keep branches and failure details through parsing', () => {
    const document = emptyConversationDocument()
    document.messages = [
      {
        key: 'q1',
        from: 'user',
        selectedVersionId: 'q1-v2',
        versions: [
          {
            id: 'q1-v1',
            content: 'first',
            continuation: [
              {
                ...reply('a1', ''),
                status: 'error',
                errorMessage: 'Request error occurred: HTTP 500',
              },
            ],
          },
          { id: 'q1-v2', content: 'second' },
        ],
      },
    ]
    const parsed = parseConversation({
      id: 1,
      title: 'Branches',
      revision: 1,
      create_time: 1,
      update_time: 1,
      document: structuredClone(document),
    })
    const branch = parsed.document.messages[0].versions[0].continuation ?? []
    expect(branch).toHaveLength(1)
    expect(branch[0].errorMessage).toBe('Request error occurred: HTTP 500')
    expect(branch[0].status).toBe('error')
  })
})
