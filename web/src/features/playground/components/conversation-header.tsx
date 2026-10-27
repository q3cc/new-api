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
import { Loader2Icon, PencilIcon, SparklesIcon, Trash2Icon } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'

import { useConversationEntry } from '../hooks/use-workspace'
import {
  isGeneratingDocument,
  type ConversationWorkspace,
} from '../lib/conversation-workspace'
import { ConversationDialogs } from './conversation-dialogs'
import { ConversationExportMenu } from './conversation-export-menu'

type Props = {
  workspace: ConversationWorkspace
  entryKey: string
}

/**
 * The title and the actions of the open conversation. It follows its own
 * entry, so the rest of the page is not re-rendered by every saved token.
 */
export function ConversationHeaderActions(
  props: Props & { onDeleted: () => Promise<void> }
) {
  const { t } = useTranslation()
  const entry = useConversationEntry(props.workspace, props.entryKey)
  const [dialog, setDialog] = useState<'rename' | 'delete' | null>(null)
  if (!entry) return null
  const generatingReply = isGeneratingDocument(entry.row.document)
  return (
    <>
      <span className='min-w-0 flex-1 truncate'>
        {entry.row.title === 'Imported conversation'
          ? t('Imported conversation')
          : entry.row.title || t('New conversation')}
      </span>
      {entry.saving && (
        <span role='status' className='text-muted-foreground text-xs'>
          {t('Saving...')}
        </span>
      )}
      <ConversationExportMenu
        conversation={entry.row}
        busy={generatingReply || !!entry.compressionProgress}
      />
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant='ghost'
              size='icon'
              className='touch-manipulation pointer-coarse:size-10'
              aria-label={
                entry.titleGenerating
                  ? t('Generating title...')
                  : t('Generate title')
              }
              disabled={
                entry.titleGenerating ||
                generatingReply ||
                !!entry.error ||
                !entry.row.document.messages.length
              }
              onClick={() =>
                void props.workspace.generateTitle(entry.key, true)
              }
            >
              {entry.titleGenerating ? (
                <Loader2Icon className='animate-spin' aria-hidden='true' />
              ) : (
                <SparklesIcon aria-hidden='true' />
              )}
            </Button>
          }
        />
        <TooltipContent>{t('Generate title')}</TooltipContent>
      </Tooltip>
      <Button
        variant='ghost'
        size='icon'
        className='touch-manipulation pointer-coarse:size-10'
        aria-label={t('Rename conversation')}
        onClick={() => setDialog('rename')}
      >
        <PencilIcon aria-hidden='true' />
      </Button>
      <Button
        variant='ghost'
        size='icon'
        className='touch-manipulation pointer-coarse:size-10'
        aria-label={t('Delete conversation')}
        onClick={() => setDialog('delete')}
      >
        <Trash2Icon aria-hidden='true' />
      </Button>
      {dialog && (
        <ConversationDialogs
          key={dialog + entry.key}
          action={dialog}
          title={entry.row.title}
          onClose={() => setDialog(null)}
          onConfirm={async (title) => {
            if (dialog === 'rename') {
              props.workspace.rename(entry.key, title)
              if (!(await props.workspace.flush(entry.key))) {
                throw (
                  props.workspace.getSnapshot().entries[entry.key]?.error ??
                  new Error('Failed to save conversation')
                )
              }
              return
            }
            await props.workspace.remove(entry.key)
            await props.onDeleted()
          }}
        />
      )}
    </>
  )
}

/** Offers a retry when the automatic title was not generated. */
export function ConversationTitleNotice(props: Props) {
  const { t } = useTranslation()
  const entry = useConversationEntry(props.workspace, props.entryKey)
  if (
    !entry ||
    entry.titleGenerating ||
    entry.error ||
    !entry.row.document.messages.length ||
    !['failed', 'requested'].includes(entry.row.document.titleGeneration ?? '')
  ) {
    return null
  }
  return (
    <div
      role='status'
      className='flex flex-wrap items-center gap-2 px-3 py-2 text-sm'
    >
      <span>{t('Title not generated')}</span>
      <Button
        variant='outline'
        size='sm'
        disabled={isGeneratingDocument(entry.row.document)}
        onClick={() => void props.workspace.generateTitle(entry.key, true)}
      >
        {t('Retry')}
      </Button>
    </div>
  )
}
