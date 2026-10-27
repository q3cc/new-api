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
import { memo } from 'react'
import { useTranslation } from 'react-i18next'

import {
  Branch,
  BranchSelector,
  BranchPrevious,
  BranchNext,
  BranchPage,
} from '@/components/ai-elements/branch'

import { isErrorMessage, type MessageAlignment } from '../../lib'
import { getCurrentVersion } from '../../lib/message/message-utils'
import type { Message } from '../../types'
import { MessageActions } from '../message/message-actions'
import { MessageErrorActions } from '../message/message-error-actions'
import { PlaygroundMessageContent } from '../message/playground-message-content'

type Props = {
  message: Message
  /** The message's current text, as the chat computed it. */
  content: string
  alignment: MessageAlignment
  alwaysShowActions: boolean
  isGenerating: boolean
  isSourceVisible: boolean
  contextLengthError: boolean
  /** The question before a failed reply, offered for editing. */
  previousUserMessage: Message | null
  onSelectVersion?: (message: Message, id: string) => void
  onCopyMessage?: (message: Message) => void
  onRegenerateMessage?: (message: Message) => void
  onEditMessage?: (message: Message) => void
  onDeleteMessage?: (message: Message) => void
  onToggleSource: (message: Message) => void
  onCompress?: (message: Message) => void
}

/**
 * One message of the chat. It is memoized so a reply streaming at the end of
 * the list does not re-render the messages above it.
 */
export const PlaygroundChatMessage = memo(function PlaygroundChatMessage(
  props: Props
) {
  const { t } = useTranslation()
  const message = props.message
  const isError = isErrorMessage(message)
  const onSelectVersion = props.onSelectVersion
  const onRegenerateMessage = props.onRegenerateMessage
  const onEditMessage = props.onEditMessage
  const onDeleteMessage = props.onDeleteMessage
  const onCompress = props.onCompress
  const previousUserMessage = props.previousUserMessage
  return (
    <PlaygroundMessageContent
      alignment={props.alignment}
      actions={
        <>
          {message.versions.length > 1 && onSelectVersion && (
            <Branch
              className='w-auto'
              branch={message.versions.findIndex(
                (version) => version.id === getCurrentVersion(message).id
              )}
              branchCount={message.versions.length}
              onBranchChange={(index) =>
                onSelectVersion(message, message.versions[index].id)
              }
            >
              <BranchSelector from={message.from} className='self-start px-0'>
                <BranchPrevious
                  aria-label={t('Previous reply')}
                  disabled={props.isGenerating}
                />
                <BranchPage />
                <BranchNext
                  aria-label={t('Next reply')}
                  disabled={props.isGenerating}
                />
              </BranchSelector>
            </Branch>
          )}
          <MessageActions
            message={message}
            onCopy={props.onCopyMessage}
            onRegenerate={onRegenerateMessage}
            onToggleSource={props.onToggleSource}
            onEdit={onEditMessage}
            onDelete={onDeleteMessage}
            isSourceVisible={props.isSourceVisible}
            isGenerating={props.isGenerating}
            alwaysVisible={props.alwaysShowActions}
            className='mt-1.5'
          />
        </>
      }
      isSourceVisible={props.isSourceVisible}
      message={message}
      errorActions={
        isError ? (
          <MessageErrorActions
            disabled={props.isGenerating}
            contextLengthError={props.contextLengthError}
            onCompress={
              props.contextLengthError && onCompress
                ? () => onCompress(message)
                : undefined
            }
            onRetry={
              onRegenerateMessage
                ? () => onRegenerateMessage(message)
                : undefined
            }
            onEditPrompt={
              onEditMessage && previousUserMessage
                ? () => onEditMessage(previousUserMessage)
                : undefined
            }
            onDelete={
              onDeleteMessage ? () => onDeleteMessage(message) : undefined
            }
          />
        ) : undefined
      }
      versionContent={props.content}
    />
  )
})
