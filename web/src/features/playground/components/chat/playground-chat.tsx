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
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from '@/components/ai-elements/conversation'
import { Loader } from '@/components/ai-elements/loader'
import { Message } from '@/components/ai-elements/message'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { Button } from '@/components/ui/button'

import {
  getChatMessageRenderState,
  getEditingMessageContent,
  getMessageAlignment,
  getMessageErrorText,
  getPreviousUserMessage,
  isContextLengthError,
  isErrorMessage,
} from '../../lib'
import type {
  Message as MessageType,
  PlaygroundMessageLayoutMode,
} from '../../types'
import { PlaygroundMessageEditor } from '../message/playground-message-editor'
import { PlaygroundChatMessage } from './playground-chat-message'
import { PlaygroundEmptyState } from './playground-empty-state'

const MAX_RENDERED_HISTORY_MESSAGES = 24

interface PlaygroundChatProps {
  messages: MessageType[]
  onSelectVersion?: (message: MessageType, id: string) => void
  onCopyMessage?: (message: MessageType) => void
  onRegenerateMessage?: (message: MessageType) => void
  onEditMessage?: (message: MessageType) => void
  onDeleteMessage?: (message: MessageType) => void
  onSelectPrompt?: (prompt: string) => void
  isGenerating?: boolean
  isLoadingMessages?: boolean
  editingKey?: string | null
  onSaveEdit?: (newContent: string) => void
  onCancelEdit?: (open: boolean) => void
  onSaveEditAndSubmit?: (newContent: string) => void
  /** Compress the context and retry the failed reply; absent when too few turns remain. */
  onCompress?: (message: MessageType) => void
  messageLayoutMode?: PlaygroundMessageLayoutMode
}

export function PlaygroundChat({
  messages,
  onSelectVersion,
  onCopyMessage,
  onRegenerateMessage,
  onEditMessage,
  onDeleteMessage,
  onSelectPrompt,
  isGenerating = false,
  isLoadingMessages = false,
  editingKey,
  onSaveEdit,
  onCancelEdit,
  onSaveEditAndSubmit,
  onCompress,
  messageLayoutMode = 'alternating',
}: PlaygroundChatProps) {
  const { t } = useTranslation()
  const [editText, setEditText] = useState('')
  const [originalText, setOriginalText] = useState('')
  const [historyLimit, setHistoryLimit] = useState(
    MAX_RENDERED_HISTORY_MESSAGES
  )
  const [sourceMessageKeys, setSourceMessageKeys] = useState<
    ReadonlySet<string>
  >(() => new Set())
  // Deleting a message also drops its other versions and their replies, so
  // the user confirms it first.
  const [deleting, setDeleting] = useState<MessageType | null>(null)
  const requestDelete = useCallback(
    (message: MessageType) => setDeleting(message),
    []
  )
  const visibleMessageOffset = Math.max(0, messages.length - historyLimit)
  const visibleMessages = messages.slice(visibleMessageOffset)

  const handleToggleMessageSource = useCallback((message: MessageType) => {
    setSourceMessageKeys((currentKeys) => {
      const nextKeys = new Set(currentKeys)

      if (nextKeys.has(message.key)) {
        nextKeys.delete(message.key)
      } else {
        nextKeys.add(message.key)
      }

      return nextKeys
    })
  }, [])

  useEffect(() => {
    if (!editingKey) return
    const content = getEditingMessageContent(messages, editingKey)
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setEditText(content)

    setOriginalText(content)
  }, [editingKey, messages])

  let chatContent = visibleMessages.map((message, visibleMessageIndex) => {
    const messageIndex = visibleMessageOffset + visibleMessageIndex
    const { alwaysShowActions, content, isEditing } = getChatMessageRenderState(
      messages,
      message,
      messageIndex,
      editingKey
    )
    const isError = isErrorMessage(message)
    const contextLengthError =
      isError &&
      isContextLengthError(message.errorCode, getMessageErrorText(message))
    const previousUserMessage = isError
      ? getPreviousUserMessage(messages, messageIndex)
      : null
    const alignment = getMessageAlignment(message, messageLayoutMode)
    const isSourceVisible = sourceMessageKeys.has(message.key)

    return (
      <Message
        className='group flex-row-reverse py-2.5'
        from={message.from}
        key={message.key}
      >
        <div className='w-full min-w-0 flex-1 basis-full'>
          {isEditing ? (
            <PlaygroundMessageEditor
              editText={editText}
              message={message}
              onCancelEdit={onCancelEdit}
              onEditTextChange={setEditText}
              onSaveEdit={onSaveEdit}
              onSaveEditAndSubmit={onSaveEditAndSubmit}
              originalText={originalText}
            />
          ) : (
            <PlaygroundChatMessage
              message={message}
              content={content}
              alignment={alignment}
              alwaysShowActions={alwaysShowActions}
              isGenerating={isGenerating}
              isSourceVisible={isSourceVisible}
              contextLengthError={contextLengthError}
              previousUserMessage={previousUserMessage}
              onSelectVersion={onSelectVersion}
              onCopyMessage={onCopyMessage}
              onRegenerateMessage={onRegenerateMessage}
              onEditMessage={onEditMessage}
              onDeleteMessage={onDeleteMessage ? requestDelete : undefined}
              onToggleSource={handleToggleMessageSource}
              onCompress={onCompress}
            />
          )}
        </div>
      </Message>
    )
  })

  if (visibleMessages.length === 0 && onSelectPrompt) {
    chatContent = [
      <PlaygroundEmptyState key='empty' onSelectPrompt={onSelectPrompt} />,
    ]
  }

  if (isLoadingMessages) {
    chatContent = [
      <div
        className='text-muted-foreground flex min-h-[min(520px,calc(100svh-18rem))] items-center justify-center gap-2 text-sm'
        key='loading'
      >
        <Loader />
        <span>{t('Loading conversation...')}</span>
      </div>,
    ]
  }

  return (
    <Conversation className='h-full'>
      {/* Remove outer padding; apply padding to inner centered container to align with input */}
      <ConversationContent
        className='p-0'
        scrollClassName='overflow-x-hidden overflow-y-auto overscroll-y-contain'
      >
        <div className='mx-auto w-full max-w-4xl px-4 py-4'>
          {visibleMessageOffset > 0 && (
            <Button
              variant='outline'
              className='touch-manipulation pointer-coarse:min-h-11'
              onClick={() =>
                setHistoryLimit(
                  (count) => count + MAX_RENDERED_HISTORY_MESSAGES
                )
              }
            >
              {t('Show earlier messages')}
            </Button>
          )}
          {chatContent}
        </div>
      </ConversationContent>
      <ConversationScrollButton />
      {deleting && (
        <ConfirmDialog
          open
          onOpenChange={(open) => {
            if (!open) setDeleting(null)
          }}
          title={t('Delete message')}
          desc={t(
            'This message and all of its versions, including the replies that followed them, will be removed. This cannot be undone.'
          )}
          destructive
          confirmText={t('Delete')}
          handleConfirm={() => {
            onDeleteMessage?.(deleting)
            setDeleting(null)
          }}
        />
      )}
    </Conversation>
  )
}
