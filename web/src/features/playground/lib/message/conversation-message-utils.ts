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
import { MESSAGE_ROLES, MESSAGE_STATUS } from '../../constants'
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
import type { Message, MessageVersion } from '../../types'
import {
  createLoadingAssistantMessage,
  createMessageVersion,
  createUserMessage,
  getMessageContent,
  getCurrentVersion,
  hasMessageContent,
  isGeneratingMessage,
  selectMessageVersion,
  updateCurrentVersionContent,
} from './message-utils'

type ApplyMessageEditResult = {
  messages: Message[]
  shouldSend: boolean
}

type ChatMessageRenderState = {
  alwaysShowActions: boolean
  content: string
  isEditing: boolean
}

export function appendUserMessagePair(
  messages: Message[],
  content: string
): Message[] {
  const submittedAt = Date.now()

  return [
    ...messages,
    createUserMessage(content, submittedAt),
    createLoadingAssistantMessage(submittedAt),
  ]
}

// The version keeps what followed it, so selecting it again brings that back.
function withContinuation(
  version: MessageVersion,
  continuation: Message[]
): MessageVersion {
  if (!continuation.length) {
    const { continuation: _dropped, ...rest } = version
    return rest
  }
  return { ...version, continuation }
}

// A version worth keeping as a branch: it has text, or it failed or was
// interrupted and the user may want to see why.
function isKeptVersion(version: MessageVersion): boolean {
  const status = version.state?.status
  return (
    version.content.trim() !== '' ||
    status === MESSAGE_STATUS.ERROR ||
    status === MESSAGE_STATUS.INTERRUPTED
  )
}

/**
 * Selects another version of a message. The messages after the message move
 * into the version that was selected until now, and the messages the target
 * version carried come back after it, so each version keeps its own branch.
 */
export function switchMessageVersion(
  messages: Message[],
  messageKey: string,
  versionId: string
): Message[] {
  const index = messages.findIndex((message) => message.key === messageKey)
  if (index === -1) return messages
  const message = messages[index]
  const current = getCurrentVersion(message)
  const target = message.versions.find((version) => version.id === versionId)
  if (!target || target.id === current.id) return messages
  const switched = selectMessageVersion(message, versionId)
  const tail = messages.slice(index + 1)
  const versions = switched.versions.map((version) => {
    if (version.id === current.id) return withContinuation(version, tail)
    if (version.id === target.id) return withContinuation(version, [])
    return version
  })
  return [
    ...messages.slice(0, index),
    { ...switched, versions },
    ...(target.continuation ?? []),
  ]
}

/**
 * Marks requests in progress as interrupted. A reply that received nothing
 * and has an earlier version returns to that version, with what followed it.
 */
export function interruptMessages(
  messages: Message[],
  keys?: ReadonlySet<string>
): Message[] {
  let result = messages
  for (const message of messages) {
    if (!isGeneratingMessage(message) || (keys && !keys.has(message.key))) {
      continue
    }
    const interrupted: Message = {
      ...message,
      status: MESSAGE_STATUS.INTERRUPTED,
      isReasoningStreaming: false,
    }
    const current = getCurrentVersion(message)
    const previous = [...message.versions]
      .reverse()
      .find((version) => version.id !== current.id)
    if (hasMessageContent(message) || !previous) {
      result = result.map((item) =>
        item.key === message.key ? interrupted : item
      )
      continue
    }
    result = switchMessageVersion(
      result.map((item) => (item.key === message.key ? interrupted : item)),
      message.key,
      previous.id
    ).map((item) =>
      item.key === message.key
        ? {
            ...item,
            versions: item.versions.filter(
              (version) => version.id !== current.id
            ),
          }
        : item
    )
  }
  return result
}

export function createRegeneratedMessages(
  messages: Message[],
  messageKey: string
): Message[] | null {
  const messageIndex = messages.findIndex(
    (message) => message.key === messageKey
  )

  if (messageIndex === -1) {
    return null
  }

  const replyIndex =
    messages[messageIndex].from === MESSAGE_ROLES.USER
      ? messageIndex + 1
      : messageIndex
  const previous = messages[replyIndex]
  const loading = createLoadingAssistantMessage()
  if (!previous || previous.from !== MESSAGE_ROLES.ASSISTANT) {
    return [...messages.slice(0, replyIndex), loading]
  }
  const current = getCurrentVersion(previous)
  const {
    key: _key,
    from: _from,
    versions: _versions,
    selectedVersionId: _selected,
    ...state
  } = previous
  // The reply's own branch keeps what followed it; the new reply starts fresh.
  const tail = messages.slice(replyIndex + 1)
  const versions = previous.versions
    .map((version) =>
      version.id === current.id
        ? withContinuation({ ...version, state }, tail)
        : version
    )
    .filter(isKeptVersion)
  return [
    ...messages.slice(0, replyIndex),
    {
      ...loading,
      key: previous.key,
      versions: [...versions, ...loading.versions],
      selectedVersionId: loading.versions[0].id,
    },
  ]
}

export function removeMessageByKey(
  messages: Message[],
  messageKey: string
): Message[] {
  return messages.filter((message) => message.key !== messageKey)
}

export function getPreviousUserMessage(
  messages: Message[],
  beforeIndex: number
): Message | null {
  for (let index = beforeIndex - 1; index >= 0; index--) {
    if (messages[index].from === MESSAGE_ROLES.USER) {
      return messages[index]
    }
  }

  return null
}

export function applyMessageEdit(
  messages: Message[],
  messageKey: string,
  content: string,
  shouldSubmit: boolean
): ApplyMessageEditResult | null {
  const submittedAt = Date.now()
  const messageIndex = messages.findIndex(
    (message) => message.key === messageKey
  )

  if (messageIndex === -1) {
    return null
  }

  const message = messages[messageIndex]
  if (!shouldSubmit || message.from !== MESSAGE_ROLES.USER) {
    return {
      messages: messages.map((item) =>
        item.key === messageKey
          ? updateCurrentVersionContent(item, content)
          : item
      ),
      shouldSend: false,
    }
  }

  // Sending an edited question starts a branch: the question gets a new
  // version, and the version asked so far keeps the replies it received.
  const current = getCurrentVersion(message)
  const {
    key,
    from,
    versions,
    selectedVersionId: _selected,
    ...state
  } = message
  const version = createMessageVersion(content)
  const edited: Message = {
    key,
    from,
    versions: [
      ...versions.map((item) =>
        item.id === current.id
          ? withContinuation(
              { ...item, state },
              messages.slice(messageIndex + 1)
            )
          : item
      ),
      version,
    ],
    selectedVersionId: version.id,
    createdAt: submittedAt,
  }
  return {
    messages: [
      ...messages.slice(0, messageIndex),
      edited,
      createLoadingAssistantMessage(submittedAt),
    ],
    shouldSend: true,
  }
}

export function getEditingMessageContent(
  messages: Message[],
  editingKey?: string | null
): string {
  if (!editingKey) {
    return ''
  }

  const message = messages.find((item) => item.key === editingKey)
  return message ? getMessageContent(message) : ''
}

export function getChatMessageRenderState(
  messages: Message[],
  message: Message,
  messageIndex: number,
  editingKey?: string | null
): ChatMessageRenderState {
  return {
    alwaysShowActions:
      messageIndex === messages.length - 1 &&
      message.from === MESSAGE_ROLES.ASSISTANT,
    content: getMessageContent(message),
    isEditing: editingKey === message.key,
  }
}
