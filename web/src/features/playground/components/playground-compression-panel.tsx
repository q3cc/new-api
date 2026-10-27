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
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { toIntlLocale } from '@/i18n/languages'
import { formatNumber } from '@/lib/format'
import { getServerErrorMessage } from '@/lib/server-error-message'

import type { usePlaygroundCompression } from '../hooks/use-playground-compression'
import { shouldCompress, validCompression } from '../lib/context-compression'
import type {
  ConversationEntry,
  ConversationWorkspace,
} from '../lib/conversation-workspace'
import type { GroupOption } from '../types'
import { CompressionSettingsDialog } from './compression/compression-settings-dialog'
import { ContextUsageTrigger } from './compression/context-usage-trigger'
import { SummaryDialog } from './compression/summary-dialog'

type Props = {
  entry: ConversationEntry
  workspace: ConversationWorkspace
  compression: ReturnType<typeof usePlaygroundCompression>
  disabled: boolean
  groups: GroupOption[]
}

/**
 * The context usage ring with its actions, and the dialogs they open. The
 * numbers shown come from the compression hook; this component only words
 * them and wires the actions to the workspace.
 */
export function PlaygroundCompressionPanel(props: Props) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const [dialog, setDialog] = useState<'settings' | 'summary' | null>(null)
  const document = props.entry.row.document
  const summary = validCompression(document)
  const selectedModel = props.compression.compressionModel
  const { usage, budget, budgetAssumed, assumedWindow, busy } =
    props.compression
  const used = busy ? undefined : usage.data?.input_tokens
  // An assumed window is a guess, so the count is shown with the assumption
  // spelled out instead of as a share of a limit nobody confirmed.
  const shownBudget = budgetAssumed ? undefined : budget
  let usageText = t('Context size unavailable')
  if (budget !== undefined) {
    if (usage.isError) {
      usageText = t('Failed to estimate context')
    } else if (used === undefined) {
      usageText = t('Estimating...')
    } else if (shownBudget) {
      usageText = `${formatNumber(used, locale)} / ${formatNumber(shownBudget, locale)} tokens · ${formatNumber((used / shownBudget) * 100, locale)}%`
    } else {
      usageText = t('{{tokens}} tokens (assuming a {{window}} token window)', {
        tokens: formatNumber(used, locale),
        window: formatNumber(assumedWindow ?? 0, locale),
      })
    }
  }
  return (
    <>
      <ContextUsageTrigger
        usageText={usageText}
        used={used}
        shownBudget={shownBudget}
        busy={busy}
        estimating={usage.isFetching}
        estimateFailed={usage.isError}
        onRetryEstimate={() => void usage.refetch()}
        disabled={props.disabled}
        canCompress={!!selectedModel && shouldCompress(document, 1, 1)}
        pendingAttempt={!!document.compressionAttempt}
        onCompress={() => {
          if (selectedModel) {
            void props.workspace.compress(
              props.entry.key,
              selectedModel,
              props.compression.compressionGroup
            )
          }
        }}
        onOpenSettings={() => setDialog('settings')}
        hasSummary={!!summary}
        onViewSummary={() => setDialog('summary')}
        onUndoCompression={() =>
          props.workspace.update(props.entry.key, (row) => ({
            ...row,
            document: {
              ...row.document,
              compression: undefined,
              compressionAttempt: undefined,
            },
          }))
        }
        compressionWarning={!!selectedModel?.compression_warning}
      />
      <CompressionSettingsDialog
        open={dialog === 'settings'}
        onClose={() => setDialog(null)}
        entry={props.entry}
        workspace={props.workspace}
        compression={props.compression}
        disabled={props.disabled}
        groups={props.groups}
      />
      <SummaryDialog
        open={dialog === 'summary'}
        onClose={() => setDialog(null)}
        summary={summary?.summary}
      />
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
    compression.compressionCapabilities.error ??
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
                void compression.compressionCapabilities.refetch()
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
