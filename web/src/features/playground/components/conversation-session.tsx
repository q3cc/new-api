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
import { isAxiosError } from 'axios'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { getServerErrorMessage } from '@/lib/server-error-message'

import {
  useChatHandler,
  usePlaygroundConversation,
  usePlaygroundOptions,
} from '../hooks'
import { usePlaygroundCompression } from '../hooks/use-playground-compression'
import { shouldCompress } from '../lib/context-compression'
import {
  interruptedDocument,
  type ConversationEntry,
  type ConversationWorkspace,
} from '../lib/conversation-workspace'
import { discardFailedReply } from '../lib/message/message-utils'
import type { Message, GroupOption, ModelOption } from '../types'
import { PlaygroundChat } from './chat/playground-chat'
import { PlaygroundInput } from './input/playground-input'
import {
  PlaygroundCompressionPanel,
  PlaygroundCompressionStatus,
} from './playground-compression-panel'

type Props = {
  entry: ConversationEntry
  workspace: ConversationWorkspace
  active: boolean
  onReload: () => void
  onCopy: () => void
}

export function ConversationSession(props: Props) {
  const [starting, setStarting] = useState(false)
  const [preparationError, setPreparationError] = useState<unknown>()
  const preparing = useRef<AbortController | null>(null)
  const generation = useRef(0)
  const key = props.entry.key
  const workspace = props.workspace
  const compression = usePlaygroundCompression(
    props.entry,
    workspace,
    props.active
  )
  const updateMessages = useCallback(
    (updater: Message[] | ((previous: Message[]) => Message[])) => {
      workspace.update(key, (row) => {
        const messages =
          typeof updater === 'function'
            ? updater(row.document.messages)
            : updater
        if (
          messages.length === row.document.messages.length &&
          messages.every(
            (message, index) => message === row.document.messages[index]
          )
        ) {
          return row
        }
        return { ...row, document: { ...row.document, messages } }
      })
    },
    [key, workspace]
  )
  const chat = useChatHandler({
    config: props.entry.row.document.config,
    parameterEnabled: props.entry.row.document.parameterEnabled,
    onMessageUpdate: updateMessages,
  })
  const { stopGeneration, sendChat: sendRequest } = chat
  const stop = useCallback(() => {
    preparing.current?.abort()
    workspace.cancelCompression(key)
    const pendingKeys = new Set(
      workspace
        .getSnapshot()
        .entries[key]?.row.document.messages.filter(
          (message) =>
            message.status === 'loading' || message.status === 'streaming'
        )
        .map((message) => message.key)
    )
    generation.current += 1
    setStarting(false)
    stopGeneration()
    if (!pendingKeys.size) return
    workspace.update(key, (row) => ({
      ...row,
      document: {
        ...row.document,
        messages: row.document.messages.map((message) =>
          pendingKeys.has(message.key)
            ? discardFailedReply({
                ...message,
                status: 'interrupted',
                isReasoningStreaming: false,
              })
            : message
        ),
      },
    }))
    if (!workspace.getSnapshot().entries[key]?.error) void workspace.flush(key)
  }, [stopGeneration, workspace, key])
  useEffect(() => workspace.registerStop(key, stop), [key, workspace, stop])
  const sendChat = useCallback(
    (messages: Message[]) => {
      if (
        !workspace.isActive() ||
        workspace.getSnapshot().entries[key]?.error
      ) {
        return
      }
      const request = ++generation.current
      const controller = new AbortController()
      preparing.current?.abort()
      preparing.current = controller
      setPreparationError(undefined)
      setStarting(true)
      void workspace
        .flush(key)
        .then(async (saved) => {
          if (!workspace.isActive() || request !== generation.current) return
          if (saved) {
            const context = await compression.prepare(
              messages,
              controller.signal
            )
            if (!workspace.isActive() || request !== generation.current) return
            setStarting(false)
            sendRequest(context)
          } else {
            workspace.update(key, (row) => ({
              ...row,
              document: interruptedDocument(row.document),
            }))
          }
        })
        .catch((error: unknown) => {
          if (
            controller.signal.aborted ||
            !workspace.isActive() ||
            request !== generation.current
          ) {
            return
          }
          setPreparationError(error)
          workspace.update(key, (row) => ({
            ...row,
            document: interruptedDocument(row.document),
          }))
        })
        .finally(() => {
          if (request === generation.current) setStarting(false)
        })
    },
    [sendRequest, key, workspace, compression]
  )
  const conversation = usePlaygroundConversation({
    messages: props.entry.row.document.messages,
    updateMessages,
    sendChat,
  })
  useEffect(() => {
    void workspace.generateTitle(key)
  }, [workspace, key, props.entry.row.document, props.entry.error])
  useEffect(() => {
    if (
      props.entry.error &&
      isAxiosError(props.entry.error) &&
      [404, 409].includes(props.entry.error.response?.status ?? 0)
    ) {
      stop()
    }
  }, [props.entry.error, stop])
  if (!props.active) return null
  return (
    <ConversationView
      {...props}
      conversation={conversation}
      generating={
        starting || chat.isGenerating || !!props.entry.compressionProgress
      }
      stop={stop}
      compression={compression}
      preparationError={preparationError}
    />
  )
}

type ViewProps = Props & {
  compression: ReturnType<typeof usePlaygroundCompression>
  preparationError?: unknown
  conversation: ReturnType<typeof usePlaygroundConversation>
  generating: boolean
  stop: () => void
}

function ConversationView(props: ViewProps) {
  const { t } = useTranslation()
  const [models, setModels] = useState<ModelOption[]>([])
  const [groups, setGroups] = useState<GroupOption[]>([])
  const document = props.entry.row.document
  const updateConfig = useCallback(
    <K extends keyof typeof document.config>(
      key: K,
      value: (typeof document.config)[K]
    ) => {
      props.workspace.update(props.entry.key, (row) => {
        if (row.document.config[key] === value) return row
        return {
          ...row,
          document: {
            ...row.document,
            config: { ...row.document.config, [key]: value },
          },
        }
      })
    },
    [props.workspace, props.entry.key]
  )
  const { isLoadingModels } = usePlaygroundOptions({
    currentGroup: document.config.group,
    currentModel: document.config.model,
    setGroups,
    setModels,
    updateConfig,
  })
  const error = props.entry.error
  const conflict =
    isAxiosError(error) && [404, 409].includes(error.response?.status ?? 0)
  const compressionModel = props.compression.compressionModel
  // The shortcut only appears when compressing can actually free up context.
  const compressFromError =
    compressionModel && shouldCompress(document, 1, 1)
      ? () =>
          void props.workspace.compress(
            props.entry.key,
            compressionModel,
            props.compression.compressionGroup
          )
      : undefined
  return (
    <div className='flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden'>
      <PlaygroundCompressionStatus
        entry={props.entry}
        compression={props.compression}
      />
      {!!props.preparationError && (
        <div
          className='text-destructive shrink-0 px-4 py-2 text-sm'
          role='alert'
        >
          {t(
            getServerErrorMessage(
              props.preparationError,
              'Compression did not complete'
            )
          )}
        </div>
      )}
      {!!error && (
        <div
          className='border-destructive text-destructive flex flex-wrap items-center gap-2 border-b px-4 py-2'
          role='alert'
        >
          <span>
            {getServerErrorMessage(error, t('Failed to save conversation'))}
          </span>
          {conflict ? (
            <Button size='sm' variant='outline' onClick={props.onReload}>
              {t('Load latest conversation')}
            </Button>
          ) : (
            <Button
              size='sm'
              variant='outline'
              onClick={() => void props.workspace.flush(props.entry.key)}
            >
              {t('Retry')}
            </Button>
          )}
          <Button size='sm' variant='outline' onClick={props.onCopy}>
            {t('Save as new conversation')}
          </Button>
        </div>
      )}
      <div className='min-h-0 flex-1 overflow-hidden'>
        <PlaygroundChat
          messages={document.messages}
          onSelectVersion={props.conversation.handleSelectVersion}
          onRegenerateMessage={props.conversation.handleRegenerateMessage}
          onEditMessage={props.conversation.handleEditMessage}
          onDeleteMessage={props.conversation.handleDeleteMessage}
          onSelectPrompt={props.conversation.handleSendMessage}
          isGenerating={props.generating || !!error}
          editingKey={props.conversation.editingMessageKey}
          onCancelEdit={props.conversation.handleEditOpenChange}
          onSaveEdit={(text) => props.conversation.applyEdit(text, false)}
          onSaveEditAndSubmit={(text) =>
            props.conversation.applyEdit(text, true)
          }
          onCompress={compressFromError}
        />
      </div>
      <div className='mx-auto w-full max-w-4xl shrink-0 pb-[env(safe-area-inset-bottom)]'>
        <PlaygroundInput
          compressionControl={
            <PlaygroundCompressionPanel
              entry={props.entry}
              workspace={props.workspace}
              compression={props.compression}
              groups={groups}
              disabled={props.generating || !!error}
            />
          }
          config={document.config}
          parameterEnabled={document.parameterEnabled}
          draft={document.draft}
          onDraftChange={(draft) =>
            props.workspace.update(props.entry.key, (row) => ({
              ...row,
              document: { ...row.document, draft },
            }))
          }
          disabled={props.generating || !!error}
          isGenerating={props.generating}
          groups={groups}
          groupValue={document.config.group}
          models={models}
          modelValue={document.config.model}
          isModelLoading={isLoadingModels}
          onConfigChange={updateConfig}
          onGroupChange={(group) => updateConfig('group', group)}
          onModelChange={(model) => updateConfig('model', model)}
          onParameterEnabledChange={(key, value) =>
            props.workspace.update(props.entry.key, (row) => ({
              ...row,
              document: {
                ...row.document,
                parameterEnabled: {
                  ...row.document.parameterEnabled,
                  [key]: value,
                },
              },
            }))
          }
          onClearMessages={() => {
            props.conversation.handleEditOpenChange(false)
            props.workspace.update(props.entry.key, (row) => ({
              ...row,
              document: {
                ...row.document,
                messages: [],
                compression: undefined,
                compressionAttempt: undefined,
              },
            }))
            void props.workspace.flush(props.entry.key)
          }}
          onStop={props.stop}
          onSubmit={props.conversation.handleSendMessage}
          hasMessages={document.messages.length > 0}
        />
      </div>
    </div>
  )
}
