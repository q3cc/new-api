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
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Dialog } from '@/components/dialog'
import { GroupSelector, ModelSelector } from '@/components/model-group-selector'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { toIntlLocale } from '@/i18n/languages'
import { getServerErrorMessage } from '@/lib/server-error-message'

import {
  getModelCapabilities,
  saveCompressionPreference,
  type CompressionSettings,
  type PlaygroundPreference,
} from '../../compression-api'
import { MAX_CUSTOM_CONTEXT_LIMIT } from '../../constants'
import type { usePlaygroundCompression } from '../../hooks/use-playground-compression'
import type {
  ConversationEntry,
  ConversationWorkspace,
} from '../../lib/conversation-workspace'
import type { GroupOption } from '../../types'
import { ContextLimitField } from './context-limit-field'

type Props = {
  open: boolean
  onClose: () => void
  entry: ConversationEntry
  workspace: ConversationWorkspace
  compression: ReturnType<typeof usePlaygroundCompression>
  disabled: boolean
  groups: GroupOption[]
}

/**
 * Where the compression model, group and automatic mode are chosen, for
 * this conversation or as the account's default, and where a model's
 * context budget can be set by hand.
 */
export function CompressionSettingsDialog(props: Props) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const [scope, setScope] = useState('conversation')
  const [limitError, setLimitError] = useState(false)
  const controller = useRef<AbortController | null>(null)
  useEffect(() => {
    const request = new AbortController()
    controller.current = request
    return () => request.abort()
  }, [])
  const client = useQueryClient()
  const owner = props.workspace.owner
  const defaults = props.compression.preference.data
  const document = props.entry.row.document
  const capabilities = props.compression.capabilities.data ?? []
  const selected = document.compressionSettings ?? defaults
  const settings = scope === 'default' ? defaults : selected
  const settingsGroup = settings?.group || document.config.group
  const settingsCapabilities = useQuery({
    queryKey: ['playground-capabilities', owner, settingsGroup],
    queryFn: ({ signal }) => getModelCapabilities(settingsGroup, signal),
    staleTime: 30000,
    enabled: props.open,
    meta: { errorToast: false },
  })
  const model = settingsCapabilities.data?.find(
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
  const models = (settingsCapabilities.data ?? [])
    .filter((item) => item.text_generation)
    .map((item) => ({ value: item.model, label: item.model }))
  const setLimit = (name: string, value: number | null) => {
    setLimitError(value === null)
    if (value === null) return
    props.workspace.update(props.entry.key, (row) => ({
      ...row,
      document: {
        ...row.document,
        contextLimits: { ...row.document.contextLimits, [name]: value },
      },
    }))
  }
  const resetLimit = (name: string) => {
    setLimitError(false)
    props.workspace.update(props.entry.key, (row) => {
      const limits = { ...row.document.contextLimits }
      delete limits[name]
      return { ...row, document: { ...row.document, contextLimits: limits } }
    })
  }
  return (
    <Dialog
      title={t('Compression settings')}
      open={props.open}
      onOpenChange={(open) => !open && props.onClose()}
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
        <Label>{t('Compression group')}</Label>
        <GroupSelector
          showLabel
          selectedGroup={settings?.group ?? ''}
          groups={[
            { value: '', label: t('Current conversation group') },
            ...props.groups,
          ]}
          disabled={!settings || mutation.isPending || props.disabled}
          onGroupChange={(group) =>
            updateSettings({ group, model: '', automatic: false })
          }
          className='w-full justify-between'
        />
      </div>
      <div className='space-y-2'>
        <Label>{t('Compression model')}</Label>
        <ModelSelector
          showLabel
          selectedModel={settings?.model ?? ''}
          models={models}
          disabled={
            !settings ||
            settingsCapabilities.isFetching ||
            mutation.isPending ||
            props.disabled
          }
          onModelChange={(model) =>
            updateSettings({ group: settings?.group, model, automatic: true })
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
            settings && updateSettings({ ...settings, automatic })
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
              if (!name) return null
              const known = [
                ...capabilities,
                ...(props.compression.compressionCapabilities.data ?? []),
              ].find((item) => item.model === name && item.text_generation)
              // A model the table does not know accepts any plausible
              // limit; the server applies the same bound.
              const ceiling = known
                ? known.input_limit || known.context_window
                : MAX_CUSTOM_CONTEXT_LIMIT
              return (
                <ContextLimitField
                  key={name}
                  id={`context-${props.entry.key}-${name}`}
                  name={name}
                  ceiling={ceiling}
                  known={!!known}
                  value={document.contextLimits?.[name]}
                  locale={locale}
                  disabled={props.disabled}
                  invalid={limitError}
                  onChange={(value) => setLimit(name, value)}
                  onReset={() => resetLimit(name)}
                />
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
      {settingsCapabilities.isError && (
        <div role='alert' className='text-destructive space-y-2'>
          <p>
            {t(
              getServerErrorMessage(
                settingsCapabilities.error,
                'Failed to load playground models'
              )
            )}
          </p>
          <Button
            variant='outline'
            onClick={() => void settingsCapabilities.refetch()}
          >
            {t('Retry')}
          </Button>
        </div>
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
  )
}
