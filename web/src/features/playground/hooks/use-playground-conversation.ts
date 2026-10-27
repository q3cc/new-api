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
import { useCallback, useEffect, useRef, useState } from 'react'

import {
  appendUserMessagePair,
  applyMessageEdit,
  createRegeneratedMessages,
  removeMessageByKey,
} from '../lib'
import { selectMessageVersion } from '../lib/message/message-utils'
import type { Message } from '../types'

type UsePlaygroundConversationOptions = {
  messages: Message[]
  updateMessages: (
    updater: Message[] | ((prev: Message[]) => Message[])
  ) => void
  sendChat: (messages: Message[]) => void
}

export function usePlaygroundConversation({
  messages,
  updateMessages,
  sendChat,
}: UsePlaygroundConversationOptions) {
  const [editingMessageKey, setEditingMessageKey] = useState<string | null>(
    null
  )
  // The handlers read the messages when they run, so their identity does not
  // change with every streamed token and memoized messages stay unrendered.
  const latestMessages = useRef(messages)
  useEffect(() => {
    latestMessages.current = messages
  }, [messages])

  const handleSendMessage = useCallback(
    (text: string) => {
      const nextMessages = appendUserMessagePair(latestMessages.current, text)
      updateMessages(nextMessages)
      sendChat(nextMessages)
    },
    [updateMessages, sendChat]
  )

  const handleRegenerateMessage = useCallback(
    (message: Message) => {
      const nextMessages = createRegeneratedMessages(
        latestMessages.current,
        message.key
      )
      if (!nextMessages) return

      updateMessages(nextMessages)
      sendChat(nextMessages)
    },
    [updateMessages, sendChat]
  )

  const handleEditMessage = useCallback((message: Message) => {
    setEditingMessageKey(message.key)
  }, [])

  const handleEditOpenChange = useCallback((open: boolean) => {
    if (!open) {
      setEditingMessageKey(null)
    }
  }, [])

  const applyEdit = useCallback(
    (newContent: string, shouldSubmit: boolean) => {
      if (!editingMessageKey) return

      const editResult = applyMessageEdit(
        latestMessages.current,
        editingMessageKey,
        newContent,
        shouldSubmit
      )
      if (!editResult) return

      setEditingMessageKey(null)
      updateMessages(editResult.messages)

      if (editResult.shouldSend) {
        sendChat(editResult.messages)
      }
    },
    [editingMessageKey, updateMessages, sendChat]
  )

  const handleDeleteMessage = useCallback(
    (message: Message) => {
      updateMessages((previousMessages) =>
        removeMessageByKey(previousMessages, message.key)
      )
    },
    [updateMessages]
  )

  const handleSelectVersion = useCallback(
    (message: Message, id: string) =>
      updateMessages((previous) =>
        previous.map((item) =>
          item.key === message.key ? selectMessageVersion(item, id) : item
        )
      ),
    [updateMessages]
  )

  return {
    handleSelectVersion,
    editingMessageKey,
    handleSendMessage,
    handleRegenerateMessage,
    handleEditMessage,
    handleEditOpenChange,
    applyEdit,
    handleDeleteMessage,
  }
}
