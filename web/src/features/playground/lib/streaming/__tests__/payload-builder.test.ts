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
import { expect, it } from 'vitest'

import { emptyConversationDocument } from '../../../conversations-api'
import type { Message } from '../../../types'
import { buildChatCompletionPayload } from '../payload-builder'

it('leaves a failed reply out of the request but keeps a stopped one', () => {
  const document = emptyConversationDocument()
  const messages: Message[] = [
    {
      key: 'question',
      from: 'user',
      versions: [{ id: 'q', content: 'What is 2 + 2?' }],
    },
    {
      key: 'failed',
      from: 'assistant',
      status: 'error',
      errorCode: 'rate_limit_exceeded',
      versions: [{ id: 'e', content: 'Request error occurred: HTTP 429' }],
    },
    {
      key: 'stopped',
      from: 'assistant',
      status: 'interrupted',
      versions: [{ id: 'i', content: '2 + 2 is' }],
    },
    {
      key: 'pending',
      from: 'assistant',
      status: 'loading',
      versions: [{ id: 'l', content: '' }],
    },
  ]

  const payload = buildChatCompletionPayload(
    messages,
    document.config,
    document.parameterEnabled
  )

  expect(payload.messages.map((message) => message.role)).toEqual([
    'user',
    'assistant',
  ])
  const sent = JSON.stringify(payload.messages)
  expect(sent).toContain('2 + 2 is')
  expect(sent).not.toContain('HTTP 429')
})
