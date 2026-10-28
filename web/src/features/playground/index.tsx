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
import {
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query'
import { MessageSquareOffIcon, PanelLeftIcon } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ConfirmDialog } from '@/components/confirm-dialog'
import { EmptyState } from '@/components/empty-state'
import { ErrorState } from '@/components/error-state'
import { LoadingState } from '@/components/loading-state'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { useDebounce } from '@/hooks/use-debounce'
import { useIsMobile } from '@/hooks/use-mobile'
import { toIntlLocale } from '@/i18n/languages'
import { formatNumber } from '@/lib/format'
import {
  getServerErrorMessage,
  getServerErrorStatus,
} from '@/lib/server-error-message'
import { useAuthStore } from '@/stores/auth-store'

import {
  ConversationHeaderActions,
  ConversationStaleNotice,
  ConversationTitleNotice,
} from './components/conversation-header'
import { ConversationList } from './components/conversation-list'
import { ConversationSession } from './components/conversation-session'
import {
  isUnrecoverableImportError,
  listConversations,
  type ConversationSummary,
  type SavedConversation,
} from './conversations-api'
import { useActiveConversation } from './hooks/use-active-conversation'
import { useWorkspaceSelector } from './hooks/use-workspace'
import { ConversationWorkspace } from './lib/conversation-workspace'

type ConversationPage = { items: ConversationSummary[]; total: number }

export function Playground() {
  const owner = useAuthStore((state) => state.auth.user?.id)
  return owner ? <PlaygroundWorkspace key={owner} owner={owner} /> : null
}

// A saved conversation the list already shows is updated in place; the list
// is fetched again only for a conversation it does not know.
function updateListedConversation(
  queryClient: QueryClient,
  queryKey: unknown[],
  row: SavedConversation
): boolean {
  let listed = false
  queryClient.setQueriesData<ConversationPage>({ queryKey }, (data) => {
    if (!data?.items.some((item) => item.id === row.id)) return data
    listed = true
    return {
      ...data,
      items: data.items.map((item) =>
        item.id === row.id
          ? {
              ...item,
              title: row.title,
              revision: row.revision,
              update_time: row.update_time,
            }
          : item
      ),
    }
  })
  return listed
}

function PlaygroundWorkspace(props: { owner: number }) {
  const { t, i18n } = useTranslation()
  const queryClient = useQueryClient()
  const isMobile = useIsMobile()
  const [workspace] = useState(
    () =>
      new ConversationWorkspace(props.owner, (row) => {
        const queryKey = ['playground-conversations', props.owner]
        if (row && updateListedConversation(queryClient, queryKey, row)) return
        void queryClient.invalidateQueries({ queryKey })
      })
  )
  const ready = useWorkspaceSelector(workspace, (snapshot) => snapshot.ready)
  const migrationError = useWorkspaceSelector(
    workspace,
    (snapshot) => snapshot.migrationError
  )
  const migrationProgress = useWorkspaceSelector(
    workspace,
    (snapshot) => snapshot.migrationProgress
  )
  const cacheError = useWorkspaceSelector(
    workspace,
    (snapshot) => snapshot.cacheError
  )
  const entryKeyList = useWorkspaceSelector(workspace, (snapshot) =>
    Object.keys(snapshot.entries).join('\n')
  )
  const entryKeys = useMemo(
    () => (entryKeyList ? entryKeyList.split('\n') : []),
    [entryKeyList]
  )
  const [discardingLegacy, setDiscardingLegacy] = useState(false)
  const [keywordInput, setKeywordInput] = useState('')
  const keyword = useDebounce(keywordInput, 300)
  // A new search starts on its first page.
  const [paging, setPaging] = useState({ keyword: '', page: 1 })
  const page = paging.keyword === keyword ? paging.page : 1
  const [expanded, setExpanded] = useState(true)
  const [mobileOpen, setMobileOpen] = useState(false)
  const list = useQuery({
    queryKey: ['playground-conversations', props.owner, keyword, page],
    queryFn: ({ signal }) => listConversations(keyword, page, signal),
    enabled: ready,
    meta: { errorToast: false },
  })
  useEffect(() => workspace.attach(), [workspace])
  const active = useActiveConversation({
    workspace,
    owner: props.owner,
    ready,
    firstId: list.data?.items[0]?.id,
    listLoaded: list.isSuccess,
    keyword,
    page,
  })
  const {
    activeKey,
    currentId,
    hasCurrent,
    opening,
    openError,
    create,
    reload,
  } = active
  const copyConversation = useCallback(() => void create(true), [create])
  const openedMissing = getServerErrorStatus(openError) === 404
  const latestId = list.data?.items.find(
    (item) => item.id !== active.searchConversation
  )?.id
  function select(id: number) {
    setMobileOpen(false)
    active.select(id)
  }
  function startConversation(copy = false) {
    setMobileOpen(false)
    void create(copy)
  }
  const listProps = {
    items: list.data?.items ?? [],
    workspace,
    activeId: currentId,
    activeKey,
    keyword: keywordInput,
    page,
    total: list.data?.total ?? 0,
    loading: list.isLoading,
    error: list.error,
    onSearch: setKeywordInput,
    onPage: (next: number) => setPaging({ keyword, page: next }),
    onNew: () => startConversation(),
    onSelect: select,
    onSelectPending: (key: string) => {
      active.selectPending(key)
      setMobileOpen(false)
    },
    onRetry: () => {
      void list.refetch()
    },
  }
  return (
    <div className='flex size-full min-h-0 overflow-hidden'>
      {!isMobile && expanded && (
        <aside className='border-border w-64 shrink-0 border-r'>
          <ConversationList {...listProps} />
        </aside>
      )}
      {isMobile && (
        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
          <SheetContent
            side='left'
            className='pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]'
          >
            <SheetHeader>
              <SheetTitle>{t('Conversations')}</SheetTitle>
            </SheetHeader>
            <ConversationList {...listProps} />
          </SheetContent>
        </Sheet>
      )}
      <section className='flex min-h-0 min-w-0 flex-1 flex-col'>
        <header className='border-border flex h-12 shrink-0 items-center gap-2 border-b px-3'>
          <Button
            variant='ghost'
            size='icon'
            className='touch-manipulation pointer-coarse:size-10'
            aria-label={t('Conversations')}
            aria-expanded={isMobile ? mobileOpen : expanded}
            onClick={() =>
              isMobile ? setMobileOpen(true) : setExpanded((value) => !value)
            }
          >
            <PanelLeftIcon aria-hidden='true' />
          </Button>
          {hasCurrent ? (
            <ConversationHeaderActions
              workspace={workspace}
              entryKey={activeKey}
              onDeleted={async () => {
                active.close()
                await list.refetch()
              }}
            />
          ) : (
            <span className='min-w-0 flex-1' />
          )}
        </header>
        {hasCurrent && (
          <>
            <ConversationStaleNotice
              workspace={workspace}
              entryKey={activeKey}
              listedRevision={
                list.data?.items.find((item) => item.id === currentId)?.revision
              }
              onReload={reload}
            />
            <ConversationTitleNotice
              workspace={workspace}
              entryKey={activeKey}
            />
          </>
        )}
        {migrationProgress &&
          !migrationError &&
          migrationProgress.phase !== 'complete' && (
            <div className='shrink-0 space-y-2 px-3 py-2' role='status'>
              <div className='flex items-center justify-between gap-2 text-sm'>
                <span>
                  {migrationProgress.phase === 'verifying'
                    ? t('Verifying conversations...')
                    : t('Uploading conversations...')}
                </span>
                <span>
                  {formatNumber(
                    Math.floor(
                      (migrationProgress.uploaded / migrationProgress.total) *
                        100
                    ),
                    toIntlLocale(i18n.resolvedLanguage || i18n.language)
                  )}
                  %
                </span>
              </div>
              <Progress
                value={
                  (migrationProgress.uploaded / migrationProgress.total) * 100
                }
                aria-label={t('Conversation upload progress')}
              />
            </div>
          )}
        {!!migrationError && (
          <div role='alert' className='flex flex-wrap items-center gap-2 p-3'>
            <span>{t('Failed to import local conversations')}</span>
            <span>{getServerErrorMessage(migrationError)}</span>
            <Button
              variant='outline'
              size='sm'
              onClick={() => void workspace.migrate()}
            >
              {t('Retry')}
            </Button>
            {isUnrecoverableImportError(migrationError) && (
              <Button
                variant='ghost'
                size='sm'
                onClick={() => setDiscardingLegacy(true)}
              >
                {t('Discard local data')}
              </Button>
            )}
            <ConfirmDialog
              open={discardingLegacy}
              onOpenChange={setDiscardingLegacy}
              title={t('Discard local conversations?')}
              desc={t(
                'The conversation saved on this device was rejected by the server and cannot be imported. Deleting it cannot be undone.'
              )}
              destructive
              confirmText={t('Discard')}
              handleConfirm={() => {
                workspace.discardLegacy()
                setDiscardingLegacy(false)
              }}
            />
          </div>
        )}
        {!!cacheError && (
          <p role='alert' className='text-destructive px-3 py-2 text-sm'>
            {getServerErrorMessage(
              cacheError,
              t('Unable to keep unsaved conversations on this device')
            )}
          </p>
        )}
        {(!ready || opening) && <LoadingState />}
        {openedMissing && (
          <EmptyState
            icon={MessageSquareOffIcon}
            title={t('This conversation no longer exists')}
            description={t(
              'It may have been deleted in another tab or on another device.'
            )}
            action={
              <>
                <Button onClick={() => startConversation()}>
                  {t('Start a new conversation')}
                </Button>
                {latestId !== undefined && (
                  <Button variant='outline' onClick={() => select(latestId)}>
                    {t('Open latest conversation')}
                  </Button>
                )}
              </>
            }
          />
        )}
        {!!openError && !openedMissing && (
          <ErrorState
            description={getServerErrorMessage(
              openError,
              t('Failed to load conversations')
            )}
            onRetry={active.retryOpen}
          />
        )}
        {ready && !opening && !openError && !hasCurrent && (
          <div className='flex flex-1 items-center justify-center'>
            <Button onClick={() => startConversation()}>
              {t('New conversation')}
            </Button>
          </div>
        )}
        {entryKeys.map((key) => (
          <ConversationSession
            key={key}
            entryKey={key}
            workspace={workspace}
            active={key === activeKey && !opening && !openError}
            onReload={reload}
            onCopy={copyConversation}
          />
        ))}
      </section>
    </div>
  )
}
