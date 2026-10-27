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
import { PlusIcon } from 'lucide-react'
import { memo } from 'react'
import { useTranslation } from 'react-i18next'

import { EmptyState } from '@/components/empty-state'
import { ErrorState } from '@/components/error-state'
import { LoadingState } from '@/components/loading-state'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { getServerErrorMessage } from '@/lib/server-error-message'

import {
  CONVERSATION_PAGE_SIZE,
  type ConversationSummary,
} from '../conversations-api'
import { useListedEntries } from '../hooks/use-workspace'
import {
  isGeneratingDocument,
  type ConversationWorkspace,
} from '../lib/conversation-workspace'

type Props = {
  items: ConversationSummary[]
  workspace: ConversationWorkspace
  activeId?: number
  activeKey: string
  keyword: string
  page: number
  total: number
  loading: boolean
  error?: unknown
  onSearch: (value: string) => void
  onPage: (page: number) => void
  onNew: () => void
  onSelect: (id: number) => void
  onSelectPending: (key: string) => void
  onRetry: () => void
}
export const ConversationList = memo(function ConversationList(props: Props) {
  const { t } = useTranslation()
  const entries = useListedEntries(props.workspace)
  return (
    <div className='flex h-full min-h-0 flex-col gap-3 p-3'>
      <Button
        className='touch-manipulation pointer-coarse:min-h-11'
        onClick={props.onNew}
      >
        <PlusIcon aria-hidden='true' />
        {t('New conversation')}
      </Button>
      <Input
        aria-label={t('Search conversations')}
        className='pointer-coarse:min-h-11'
        placeholder={t('Search conversations')}
        value={props.keyword}
        onChange={(event) => props.onSearch(event.target.value)}
      />
      <nav
        aria-label={t('Conversations')}
        className='min-h-0 flex-1 space-y-1 overflow-y-auto overscroll-contain'
      >
        {entries
          .filter((entry) => !entry.row.id)
          .map((entry) => (
            <Button
              key={entry.key}
              className='w-full touch-manipulation justify-start truncate pointer-coarse:min-h-11'
              variant={entry.key === props.activeKey ? 'secondary' : 'ghost'}
              onClick={() => props.onSelectPending(entry.key)}
            >
              {entry.row.title || t('New conversation')}
            </Button>
          ))}
        {props.loading && <LoadingState size='sm' />}
        {!!props.error && (
          <ErrorState
            description={getServerErrorMessage(
              props.error,
              t('Failed to load conversations')
            )}
            onRetry={props.onRetry}
          />
        )}
        {!props.loading && !props.error && props.items.length === 0 && (
          <EmptyState title={t('No conversations')} />
        )}
        {props.items.map((item) => {
          const local = entries.find((entry) => entry.row.id === item.id)
          const pending = local && isGeneratingDocument(local.row.document)
          return (
            <Button
              key={item.id}
              className='h-auto min-h-9 w-full touch-manipulation justify-start overflow-hidden py-2 text-start pointer-coarse:min-h-11'
              variant={item.id === props.activeId ? 'secondary' : 'ghost'}
              aria-current={item.id === props.activeId ? 'page' : undefined}
              onClick={() => props.onSelect(item.id)}
            >
              {pending && (
                <span
                  className='bg-primary size-2 shrink-0 animate-pulse rounded-full'
                  aria-label={t('Responding...')}
                />
              )}
              <span className='truncate'>
                {(local?.row.title || item.title) === 'Imported conversation'
                  ? t('Imported conversation')
                  : local?.row.title || item.title || t('New conversation')}
              </span>
            </Button>
          )
        })}
      </nav>
      {props.total > CONVERSATION_PAGE_SIZE && (
        <div className='flex items-center justify-between gap-2'>
          <Button
            variant='outline'
            size='sm'
            className='touch-manipulation pointer-coarse:min-h-11'
            disabled={props.page === 1}
            onClick={() => props.onPage(props.page - 1)}
          >
            {t('Previous')}
          </Button>
          <Button
            variant='outline'
            size='sm'
            className='touch-manipulation pointer-coarse:min-h-11'
            disabled={props.page * CONVERSATION_PAGE_SIZE >= props.total}
            onClick={() => props.onPage(props.page + 1)}
          >
            {t('Next')}
          </Button>
        </div>
      )}
    </div>
  )
})
