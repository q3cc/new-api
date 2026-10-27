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
import { useNavigate, useSearch } from '@tanstack/react-router'
import { MessageSquareOffIcon, PanelLeftIcon } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

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
  emptyConversationDocument,
  listConversations,
  type ConversationSummary,
  type SavedConversation,
} from './conversations-api'
import { useWorkspaceSelector } from './hooks/use-workspace'
import {
  ConversationWorkspace,
  interruptedDocument,
} from './lib/conversation-workspace'

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
  const navigate = useNavigate({ from: '/playground/' })
  const search = useSearch({ from: '/_authenticated/playground/' })
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
  const [activeKey, setActiveKey] = useState('')
  // The open conversation's server ID; undefined while nothing is open.
  const currentId = useWorkspaceSelector(
    workspace,
    (snapshot) => snapshot.entries[activeKey]?.row.id
  )
  const hasCurrent = currentId !== undefined
  const [keywordInput, setKeywordInput] = useState('')
  const keyword = useDebounce(keywordInput, 300)
  // A new search starts on its first page.
  const [paging, setPaging] = useState({ keyword: '', page: 1 })
  const page = paging.keyword === keyword ? paging.page : 1
  const [expanded, setExpanded] = useState(true)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [opening, setOpening] = useState(false)
  const [openError, setOpenError] = useState<unknown>()
  const [retry, setRetry] = useState(0)
  const blankConversation = useRef<Promise<string | undefined> | null>(null)
  // The last conversation that failed to open; it is not reopened until the
  // user retries or picks another one, so a list refresh does not flicker it.
  const failedOpen = useRef<{ id: number; retry: number } | null>(null)
  const list = useQuery({
    queryKey: ['playground-conversations', props.owner, keyword, page],
    queryFn: ({ signal }) => listConversations(keyword, page, signal),
    enabled: ready,
    meta: { errorToast: false },
  })
  useEffect(() => workspace.attach(), [workspace])
  const firstId = list.data?.items[0]?.id
  useEffect(() => {
    if (!ready) return
    if (
      !search.conversation &&
      activeKey &&
      workspace.getSnapshot().entries[activeKey]
    ) {
      return
    }
    const id = search.conversation ?? firstId
    if (!id) {
      const pending = Object.keys(workspace.getSnapshot().entries)[0]
      if (pending) {
        setActiveKey(pending)
      } else if (list.isSuccess && !keyword && page === 1) {
        setOpening(true)
        blankConversation.current ??= workspace.create(
          emptyConversationDocument(),
          '',
          false
        )
        void blankConversation.current
          .then((key) => {
            if (key && workspace.isActive()) setActiveKey(key)
          })
          .finally(() => {
            blankConversation.current = null
            setOpening(false)
          })
      }
      return
    }
    if (failedOpen.current?.id === id && failedOpen.current.retry === retry) {
      return
    }
    failedOpen.current = null
    const existing = Object.values(workspace.getSnapshot().entries).find(
      (entry) => entry.row.id === id
    )
    if (existing) {
      if (existing.key !== activeKey) setActiveKey(existing.key)
      setOpening(false)
      setOpenError(undefined)
      return
    }
    let cancelled = false
    setOpening(true)
    setOpenError(undefined)
    void workspace
      .open(id)
      .then((key) => {
        if (cancelled || !key) return
        setActiveKey(key)
        if (!search.conversation) {
          void navigate({ search: { conversation: id }, replace: true })
        }
      })
      .catch((error: unknown) => {
        if (cancelled) return
        failedOpen.current = { id, retry }
        setOpenError(error)
        // Deleted elsewhere: drop it from a list that may still show it.
        if (getServerErrorStatus(error) === 404) {
          void queryClient.invalidateQueries({
            queryKey: ['playground-conversations', props.owner],
          })
        }
      })
      .finally(() => {
        if (!cancelled) setOpening(false)
      })
    return () => {
      cancelled = true
    }
  }, [
    workspace,
    queryClient,
    props.owner,
    ready,
    search.conversation,
    firstId,
    navigate,
    retry,
    activeKey,
    list.isSuccess,
    keyword,
    page,
  ])
  useEffect(() => {
    if (
      !currentId ||
      search.conversation === currentId ||
      opening ||
      openError
    ) {
      return
    }
    // A recovered creation receives its server ID after an idempotent retry.
    if (!search.conversation) {
      void navigate({ search: { conversation: currentId }, replace: true })
    }
  }, [currentId, search.conversation, navigate, opening, openError])

  const create = useCallback(
    async (copy = false) => {
      setOpenError(undefined)
      const current = workspace.getSnapshot().entries[activeKey]
      const document =
        copy && current
          ? interruptedDocument(current.row.document)
          : emptyConversationDocument(
              current?.row.document.config,
              current?.row.document.parameterEnabled
            )
      const key = await workspace.create(
        document,
        copy ? current?.row.title : ''
      )
      if (!key) return
      setActiveKey(key)
      const id = workspace.getSnapshot().entries[key].row.id
      void navigate({ search: id ? { conversation: id } : {} })
      setMobileOpen(false)
    },
    [workspace, activeKey, navigate]
  )
  const copyConversation = useCallback(() => void create(true), [create])
  const reload = useCallback(
    (key: string) => {
      const id = workspace.getSnapshot().entries[key]?.row.id
      if (id) void workspace.open(id, true).catch(setOpenError)
    },
    [workspace]
  )
  const openedMissing = getServerErrorStatus(openError) === 404
  const latestId = list.data?.items.find(
    (item) => item.id !== search.conversation
  )?.id
  function select(id: number) {
    setMobileOpen(false)
    void navigate({ search: { conversation: id } })
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
    onNew: () => void create(),
    onSelect: select,
    onSelectPending: (key: string) => {
      setActiveKey(key)
      void navigate({ search: {} })
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
                setActiveKey('')
                void navigate({ search: {} })
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
                <Button onClick={() => void create()}>
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
            onRetry={() => setRetry((value) => value + 1)}
          />
        )}
        {ready && !opening && !openError && !hasCurrent && (
          <div className='flex flex-1 items-center justify-center'>
            <Button onClick={() => void create()}>
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
