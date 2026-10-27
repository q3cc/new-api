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
import { nanoid } from 'nanoid'

import { MESSAGE_STATUS } from '../constants'
import type { SavedConversation } from '../conversations-api'
import { getMessageContent } from './message/message-utils'

export type ConversationExportFormat = 'json' | 'md'

type ChatboxMessage = {
  id: string
  role: 'system' | 'user' | 'assistant'
  contentParts: { type: 'text'; text: string }[]
  timestamp?: number
}

type ChatboxSession = {
  id: string
  type: 'chat'
  name: string
  messages: ChatboxMessage[]
}

// Chatbox legacy JSON import contract, verified against commit
// 0ac6385ae1ff5bf778777826da3c5edcd55b61b8:
// src/renderer/packages/backup/legacy-import.ts and src/shared/types/session.ts.
export function exportConversation(
  conversation: SavedConversation,
  format: ConversationExportFormat,
  exportedAt = new Date()
) {
  const title = conversation.title.trim() || 'New conversation'
  // A failed reply holds the error text, not part of the conversation.
  const messages = conversation.document.messages
    .filter((message) => message.status !== 'error')
    .map((message) => ({ message, text: getMessageContent(message) }))
    .filter(({ text }) => text.trim().length > 0)
  const safeTitle =
    title
      .replaceAll(/[<>:"/\\|?*]/g, '_')
      .replaceAll(/\p{Cc}/gu, '_')
      .replaceAll(/[. ]+$/g, '')
      .slice(0, 100) || 'conversation'
  const timestamp = exportedAt.toISOString().replaceAll(/[:.]/g, '-')
  const filename = `${safeTitle}-${timestamp}.${format}`
  if (format === 'md') {
    // Leave message Markdown intact, especially nested code fences and images.
    const content = `${[
      `# ${title.replaceAll(/[\r\n]+/g, ' ')}`,
      ...messages.map(({ message, text }) =>
        message.status === MESSAGE_STATUS.INTERRUPTED
          ? `## ${message.from}\n\n${text}\n\n_(generation was interrupted)_`
          : `## ${message.from}\n\n${text}`
      ),
    ].join('\n\n')}\n`
    return { filename, content, mimeType: 'text/markdown;charset=utf-8' }
  }
  const id = nanoid()
  const session: ChatboxSession = {
    id,
    type: 'chat',
    name: title,
    messages: messages.map(({ message, text }) => ({
      id: nanoid(),
      role: message.from,
      contentParts: [{ type: 'text', text }],
      ...(Number.isFinite(message.createdAt)
        ? { timestamp: message.createdAt }
        : {}),
    })),
  }
  // The server records creation time in milliseconds already.
  const createdAt =
    conversation.create_time > 0
      ? conversation.create_time
      : exportedAt.getTime()
  const backup = {
    configVersion: 15,
    __exported_at: exportedAt.toISOString(),
    'chat-sessions-list': [
      {
        id,
        name: title,
        type: 'chat',
        createdAt,
        sortOrder: exportedAt.getTime(),
      },
    ],
    [`session:${id}`]: session,
  }
  return {
    filename,
    content: `${JSON.stringify(backup, null, 2)}\n`,
    mimeType: 'application/json;charset=utf-8',
  }
}

export function downloadConversation(
  conversation: SavedConversation,
  format: ConversationExportFormat
) {
  const file = exportConversation(conversation, format)
  const url = URL.createObjectURL(
    new Blob([file.content], { type: file.mimeType })
  )
  const anchor = document.createElement('a')
  try {
    anchor.href = url
    anchor.download = file.filename
    document.body.append(anchor)
    anchor.click()
  } finally {
    anchor.remove()
    // Keep the object alive until the browser has accepted the download.
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
}
