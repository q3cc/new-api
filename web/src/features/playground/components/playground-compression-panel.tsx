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
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Minimize2Icon, Settings2Icon } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ContextUsageIcon } from '@/components/ai-elements/context'
import { PromptInputButton } from '@/components/ai-elements/prompt-input'
import { Dialog } from '@/components/dialog'
import { ModelSelector } from '@/components/model-group-selector'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
  PopoverTitle,
} from '@/components/ui/popover'
import { Progress } from '@/components/ui/progress'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { toIntlLocale } from '@/i18n/languages'
import { formatNumber } from '@/lib/format'
import { getServerErrorMessage } from '@/lib/server-error-message'

import {
  saveCompressionPreference,
  type CompressionSettings,
  type PlaygroundPreference,
} from '../compression-api'
import type { usePlaygroundCompression } from '../hooks/use-playground-compression'
import { shouldCompress, validCompression } from '../lib/context-compression'
import type {
  ConversationEntry,
  ConversationWorkspace,
} from '../lib/conversation-workspace'

type Props = {
  entry: ConversationEntry
  workspace: ConversationWorkspace
  compression: ReturnType<typeof usePlaygroundCompression>
  disabled: boolean
}

export function PlaygroundCompressionPanel(props: Props) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const [dialog, setDialog] = useState<'settings' | 'summary' | null>(null)
  const [scope, setScope] = useState('conversation')
  const [limitError, setLimitError] = useState(false)
  const [open, setOpen] = useState(false)
  const longPress = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const suppressClick = useRef(false)
  const cancelLongPress = () => clearTimeout(longPress.current)
  const controller = useRef<AbortController | null>(null)
  useEffect(() => {
    const request = new AbortController()
    controller.current = request
    return () => {
      request.abort()
      clearTimeout(longPress.current)
    }
  }, [])
  const client = useQueryClient()
  const owner = props.workspace.owner
  const defaults = props.compression.preference.data
  const document = props.entry.row.document
  const capabilities = props.compression.capabilities.data ?? []
  const selected = document.compressionSettings ?? defaults
  const settings = scope === 'default' ? defaults : selected
  const summary = validCompression(document)
  const selectedModel = capabilities.find(
    (item) => item.model === selected?.model && item.text_generation
  )
  const model = capabilities.find(
    (item) => item.model === settings?.model && item.text_generation
  )
  const mutation = useMutation({
    mutationFn: (write: PlaygroundPreference & { operation_id: string }) =>
      saveCompressionPreference(write, controller.current?.signal),
    onSuccess: (value) => {
      if (props.workspace.isActive()) {
        client.setQueryData(['playground-preference', owner], value)
      }
    },
    onError: () => {},
  })
  const updateSettings = (value: CompressionSettings) => {
    if (scope === 'default') {
      if (defaults) {
        mutation.mutate({
          ...value,
          revision: defaults.revision,
          operation_id: crypto.randomUUID(),
        })
      }
      return
    }
    props.workspace.update(props.entry.key, (row) => ({
      ...row,
      document: { ...row.document, compressionSettings: value },
    }))
  }
  const models = capabilities
    .filter((item) => item.text_generation)
    .map((item) => ({ value: item.model, label: item.model }))
  const { usage, budget, busy } = props.compression
  const used = busy ? undefined : usage.data?.input_tokens
  const percentage =
    used !== undefined && budget
      ? `${formatNumber((used / budget) * 100, locale)}%`
      : '—'
  let usageText = t('Context size unavailable')
  if (budget !== undefined) {
    if (usage.isError) {
      usageText = t('Failed to estimate context')
    } else if (used === undefined) {
      usageText = t('Estimating...')
    } else {
      usageText = `${formatNumber(used, locale)} / ${formatNumber(budget, locale)} tokens · ${percentage}`
    }
  }
  const pendingAttempt = !!document.compressionAttempt
  return (
    <>
      <Popover
        open={open}
        onOpenChange={(value, details) => {
          if (suppressClick.current && details.reason === 'trigger-press') {
            suppressClick.current = false
            return
          }
          setOpen(value)
        }}
      >
        <Tooltip>
          <TooltipTrigger
            render={
              <PopoverTrigger
                render={
                  <PromptInputButton
                    aria-label={t('Model context usage')}
                    aria-description={usageText}
                    className={
                      used !== undefined &&
                      budget !== undefined &&
                      used >= budget * 0.8
                        ? 'text-destructive'
                        : 'text-muted-foreground hover:text-foreground'
                    }
                    onPointerDown={(event) => {
                      suppressClick.current = false
                      if (event.pointerType === 'mouse') return
                      cancelLongPress()
                      longPress.current = setTimeout(() => {
                        suppressClick.current = true
                        setOpen(true)
                      }, 450)
                    }}
                    onPointerUp={cancelLongPress}
                    onPointerMove={cancelLongPress}
                    onPointerCancel={cancelLongPress}
                    onContextMenu={(event) => event.preventDefault()}
                    onClick={(event) => {
                      if (suppressClick.current) {
                        event.preventDefault()
                      }
                    }}
                  >
                    <ContextUsageIcon
                      usedTokens={used}
                      maxTokens={budget}
                      aria-hidden='true'
                      className={
                        busy || usage.isFetching ? 'animate-pulse' : undefined
                      }
                    />
                  </PromptInputButton>
                }
              />
            }
          />
          {!open && (
            <TooltipContent className='space-y-1'>
              <p>{t('Model context usage')}</p>
              <p>{usageText}</p>
            </TooltipContent>
          )}
        </Tooltip>
        <PopoverContent
          side='top'
          align='start'
          className='w-72 max-w-[calc(100vw-2rem)]'
        >
          <PopoverTitle>{t('Model context usage')}</PopoverTitle>
          <p
            className='text-muted-foreground text-xs tabular-nums'
            role='status'
          >
            {usageText}
          </p>
          {usage.isError && (
            <Button
              size='sm'
              variant='outline'
              onClick={() => void usage.refetch()}
            >
              {t('Retry')}
            </Button>
          )}
          <div className='flex flex-wrap items-center gap-2'>
            <Button
              size='sm'
              variant='outline'
              disabled={
                props.disabled ||
                !selectedModel ||
                !shouldCompress(document, 1, 1)
              }
              onClick={() => {
                setOpen(false)
                if (selectedModel) {
                  void props.workspace.compress(props.entry.key, selectedModel)
                }
              }}
            >
              <Minimize2Icon aria-hidden='true' />
              {pendingAttempt ? t('Retry compression') : t('Compress context')}
            </Button>
            <Button
              size='icon'
              variant='ghost'
              aria-label={t('Compression settings')}
              disabled={props.disabled}
              onClick={() => {
                setOpen(false)
                setDialog('settings')
              }}
            >
              <Settings2Icon aria-hidden='true' />
            </Button>
            {summary && (
              <>
                <Button
                  size='sm'
                  variant='ghost'
                  onClick={() => {
                    setOpen(false)
                    setDialog('summary')
                  }}
                >
                  {t('View summary')}
                </Button>
                <Button
                  size='sm'
                  variant='ghost'
                  disabled={props.disabled}
                  onClick={() =>
                    props.workspace.update(props.entry.key, (row) => ({
                      ...row,
                      document: {
                        ...row.document,
                        compression: undefined,
                        compressionAttempt: undefined,
                        compressionSettings: {
                          model: selected?.model ?? '',
                          automatic: false,
                        },
                      },
                    }))
                  }
                >
                  {t('Undo compression')}
                </Button>
              </>
            )}
            {!!selectedModel?.compression_warning && (
              <span className='text-destructive'>
                {t('DeepSeek V3 models have poor compression quality')}
              </span>
            )}
          </div>
        </PopoverContent>
      </Popover>
      <Dialog
        title={t('Compression settings')}
        open={dialog === 'settings'}
        onOpenChange={(open) => !open && setDialog(null)}
        bodyClassName='space-y-4'
      >
        <Tabs value={scope} onValueChange={setScope}>
          <TabsList>
            <TabsTrigger value='conversation'>
              {t('This conversation')}
            </TabsTrigger>
            <TabsTrigger value='default'>{t('Default settings')}</TabsTrigger>
          </TabsList>
        </Tabs>
        <div className='space-y-2'>
          <Label>{t('Compression model')}</Label>
          <ModelSelector
            selectedModel={settings?.model ?? ''}
            models={models}
            disabled={!settings || mutation.isPending || props.disabled}
            onModelChange={(model) =>
              updateSettings({ model, automatic: true })
            }
            className='w-full justify-between'
          />
          {model?.compression_warning && (
            <p role='status' className='text-destructive'>
              {t('DeepSeek V3 models have poor compression quality')}
            </p>
          )}
        </div>
        <div className='flex items-center justify-between gap-3'>
          <Label htmlFor={`compression-auto-${props.entry.key}`}>
            {t('Automatic compression')}
          </Label>
          <Switch
            id={`compression-auto-${props.entry.key}`}
            checked={settings?.automatic ?? false}
            disabled={!model || mutation.isPending || props.disabled}
            onCheckedChange={(automatic) =>
              settings && updateSettings({ model: settings.model, automatic })
            }
          />
        </div>
        {scope === 'conversation' && (
          <>
            <Button
              size='sm'
              variant='outline'
              disabled={props.disabled}
              onClick={() =>
                props.workspace.update(props.entry.key, (row) => ({
                  ...row,
                  document: { ...row.document, compressionSettings: undefined },
                }))
              }
            >
              {t('Use default settings')}
            </Button>
            {[...new Set([document.config.model, selected?.model])].map(
              (name) => {
                const capability = capabilities.find(
                  (item) => item.model === name
                )
                if (!name || !capability?.text_generation) return null
                const ceiling =
                  capability.input_limit || capability.context_window
                const id = `context-${props.entry.key}-${name}`
                return (
                  <div key={name} className='space-y-2'>
                    <Label htmlFor={id}>
                      {t('Context budget')} · {name}
                    </Label>
                    <div className='flex gap-2'>
                      <Input
                        id={id}
                        key={`${name}-${document.contextLimits?.[name]}`}
                        type='number'
                        min={1}
                        max={ceiling}
                        defaultValue={document.contextLimits?.[name] ?? ceiling}
                        disabled={props.disabled}
                        aria-invalid={limitError}
                        onBlur={(event) => {
                          const value = Number(event.target.value)
                          const valid =
                            Number.isSafeInteger(value) &&
                            value > 0 &&
                            value <= ceiling
                          setLimitError(!valid)
                          if (valid) {
                            props.workspace.update(props.entry.key, (row) => ({
                              ...row,
                              document: {
                                ...row.document,
                                contextLimits: {
                                  ...row.document.contextLimits,
                                  [name]: value,
                                },
                              },
                            }))
                          }
                        }}
                      />
                      <Button
                        variant='outline'
                        disabled={props.disabled}
                        onClick={() => {
                          setLimitError(false)
                          props.workspace.update(props.entry.key, (row) => {
                            const limits = { ...row.document.contextLimits }
                            delete limits[name]
                            return {
                              ...row,
                              document: {
                                ...row.document,
                                contextLimits: limits,
                              },
                            }
                          })
                        }}
                      >
                        {t('Reset')}
                      </Button>
                    </div>
                    <span className='text-muted-foreground'>
                      {t('Maximum')}: {formatNumber(ceiling, locale)}
                    </span>
                  </div>
                )
              }
            )}
            {limitError && (
              <p role='alert' className='text-destructive'>
                {t('Invalid context budget')}
              </p>
            )}
          </>
        )}
        {mutation.isError && (
          <div role='alert' className='text-destructive space-y-2'>
            <p>
              {t(
                getServerErrorMessage(mutation.error, 'Failed to save settings')
              )}
            </p>
            <Button
              variant='outline'
              onClick={() =>
                mutation.variables && mutation.mutate(mutation.variables)
              }
            >
              {t('Retry')}
            </Button>
            <Button
              variant='ghost'
              onClick={() => {
                mutation.reset()
                void props.compression.preference.refetch()
              }}
            >
              {t('Refresh')}
            </Button>
          </div>
        )}
      </Dialog>
      <Dialog
        title={t('Conversation summary')}
        open={dialog === 'summary'}
        onOpenChange={(open) => !open && setDialog(null)}
      >
        <div className='text-left break-words whitespace-pre-wrap'>
          {summary?.summary}
        </div>
      </Dialog>
    </>
  )
}

export function PlaygroundCompressionStatus({
  entry,
  compression,
}: Pick<Props, 'entry' | 'compression'>) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const progress = entry.compressionProgress
  const error =
    entry.compressionError ??
    compression.preference.error ??
    compression.capabilities.error
  if (!progress && !error) return null
  return (
    <div className='shrink-0 space-y-1 border-b px-3 py-2 text-sm'>
      {progress && (
        <div role='status' className='space-y-1'>
          <span>
            {t('Compressing...')} {formatNumber(progress.completed, locale)} /{' '}
            {formatNumber(progress.total, locale)}
          </span>
          <Progress
            aria-label={t('Compression progress')}
            value={
              progress.total ? (progress.completed / progress.total) * 100 : 0
            }
          />
        </div>
      )}
      {!!error && (
        <div
          role='alert'
          className='text-destructive flex flex-wrap items-center gap-2'
        >
          {t(getServerErrorMessage(error, 'Compression did not complete'))}
          {!entry.compressionError && (
            <Button
              size='sm'
              variant='outline'
              onClick={() => {
                void compression.preference.refetch()
                void compression.capabilities.refetch()
              }}
            >
              {t('Retry')}
            </Button>
          )}
        </div>
      )}
    </div>
  )
}
