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
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useSearch } from '@tanstack/react-router'
import {
  Loader2Icon,
  PanelLeftIcon,
  PencilIcon,
  SparklesIcon,
  Trash2Icon,
} from 'lucide-react'
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'

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
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { useIsMobile } from '@/hooks/use-mobile'
import { toIntlLocale } from '@/i18n/languages'
import { formatNumber } from '@/lib/format'
import { getServerErrorMessage } from '@/lib/server-error-message'
import { useAuthStore } from '@/stores/auth-store'

import { ConversationDialogs } from './components/conversation-dialogs'
import { ConversationExportMenu } from './components/conversation-export-menu'
import { ConversationList } from './components/conversation-list'
import { ConversationSession } from './components/conversation-session'
import {
  emptyConversationDocument,
  listConversations,
} from './conversations-api'
import {
  ConversationWorkspace,
  interruptedDocument,
} from './lib/conversation-workspace'

export function Playground() {
  const owner = useAuthStore((state) => state.auth.user?.id)
  return owner ? <PlaygroundWorkspace key={owner} owner={owner} /> : null
}

function PlaygroundWorkspace(props: { owner: number }) {
  const { t, i18n } = useTranslation()
  const queryClient = useQueryClient()
  const navigate = useNavigate({ from: '/playground/' })
  const search = useSearch({ from: '/_authenticated/playground/' })
  const isMobile = useIsMobile()
  const [workspace] = useState(
    () =>
      new ConversationWorkspace(props.owner, () => {
        void queryClient.invalidateQueries({
          queryKey: ['playground-conversations', props.owner],
        })
      })
  )
  const snapshot = useSyncExternalStore(
    workspace.subscribe,
    workspace.getSnapshot
  )
  const [activeKey, setActiveKey] = useState('')
  const [keyword, setKeyword] = useState('')
  const [page, setPage] = useState(1)
  const [expanded, setExpanded] = useState(true)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [opening, setOpening] = useState(false)
  const [openError, setOpenError] = useState<unknown>()
  const [dialog, setDialog] = useState<'rename' | 'delete' | null>(null)
  const [retry, setRetry] = useState(0)
  const blankConversation = useRef<Promise<string | undefined> | null>(null)
  const entries = Object.values(snapshot.entries)
  const current = snapshot.entries[activeKey]
  const generatingReply = current?.row.document.messages.some(
    (message) => message.status === 'loading' || message.status === 'streaming'
  )
  const list = useQuery({
    queryKey: ['playground-conversations', props.owner, keyword, page],
    queryFn: ({ signal }) => listConversations(keyword, page, signal),
    enabled: snapshot.ready,
    meta: { errorToast: false },
  })
  useEffect(() => workspace.attach(), [workspace])
  const firstId = list.data?.items[0]?.id
  useEffect(() => {
    if (!snapshot.ready) return
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
        if (!cancelled) setOpenError(error)
      })
      .finally(() => {
        if (!cancelled) setOpening(false)
      })
    return () => {
      cancelled = true
    }
  }, [
    workspace,
    snapshot.ready,
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
      !current?.row.id ||
      search.conversation === current.row.id ||
      opening ||
      openError
    ) {
      return
    }
    // A recovered creation receives its server ID after an idempotent retry.
    if (!search.conversation) {
      void navigate({ search: { conversation: current.row.id }, replace: true })
    }
  }, [current?.row.id, search.conversation, navigate, opening, openError])

  async function create(copy = false) {
    setOpenError(undefined)
    const document =
      copy && current
        ? interruptedDocument(current.row.document)
        : emptyConversationDocument(
            current?.row.document.config,
            current?.row.document.parameterEnabled
          )
    const key = await workspace.create(document, copy ? current?.row.title : '')
    if (!key) return
    setActiveKey(key)
    const id = workspace.getSnapshot().entries[key].row.id
    void navigate({ search: id ? { conversation: id } : {} })
    setMobileOpen(false)
  }
  function select(id: number) {
    setMobileOpen(false)
    void navigate({ search: { conversation: id } })
  }
  const listProps = {
    items: list.data?.items ?? [],
    entries,
    activeId: current?.row.id,
    activeKey,
    keyword,
    page,
    total: list.data?.total ?? 0,
    loading: list.isLoading,
    error: list.error,
    onSearch: (value: string) => {
      setKeyword(value)
      setPage(1)
    },
    onPage: setPage,
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
          <span className='min-w-0 flex-1 truncate'>
            {current?.row.title === 'Imported conversation'
              ? t('Imported conversation')
              : current?.row.title || t('New conversation')}
          </span>
          {current?.saving && (
            <span role='status' className='text-muted-foreground text-xs'>
              {t('Saving...')}
            </span>
          )}
          {current && (
            <>
              <ConversationExportMenu
                conversation={current.row}
                busy={!!generatingReply || !!current.compressionProgress}
              />
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      variant='ghost'
                      size='icon'
                      className='touch-manipulation pointer-coarse:size-10'
                      aria-label={
                        current.titleGenerating
                          ? t('Generating title...')
                          : t('Generate title')
                      }
                      disabled={
                        current.titleGenerating ||
                        generatingReply ||
                        !!current.error ||
                        !current.row.document.messages.length
                      }
                      onClick={() =>
                        void workspace.generateTitle(current.key, true)
                      }
                    >
                      {current.titleGenerating ? (
                        <Loader2Icon
                          className='animate-spin'
                          aria-hidden='true'
                        />
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
            </>
          )}
        </header>
        {current &&
          !current.titleGenerating &&
          !current.error &&
          current.row.document.messages.length > 0 &&
          ['failed', 'requested'].includes(
            current.row.document.titleGeneration ?? ''
          ) && (
            <div
              role='status'
              className='flex flex-wrap items-center gap-2 px-3 py-2 text-sm'
            >
              <span>{t('Title not generated')}</span>
              <Button
                variant='outline'
                size='sm'
                disabled={generatingReply}
                onClick={() => void workspace.generateTitle(current.key, true)}
              >
                {t('Retry')}
              </Button>
            </div>
          )}
        {snapshot.migrationProgress &&
          !snapshot.migrationError &&
          snapshot.migrationProgress.phase !== 'complete' && (
            <div className='shrink-0 space-y-2 px-3 py-2' role='status'>
              <div className='flex items-center justify-between gap-2 text-sm'>
                <span>
                  {snapshot.migrationProgress.phase === 'verifying'
                    ? t('Verifying conversations...')
                    : t('Uploading conversations...')}
                </span>
                <span>
                  {formatNumber(
                    Math.floor(
                      (snapshot.migrationProgress.uploaded /
                        snapshot.migrationProgress.total) *
                        100
                    ),
                    toIntlLocale(i18n.resolvedLanguage || i18n.language)
                  )}
                  %
                </span>
              </div>
              <Progress
                value={
                  (snapshot.migrationProgress.uploaded /
                    snapshot.migrationProgress.total) *
                  100
                }
                aria-label={t('Conversation upload progress')}
              />
            </div>
          )}
        {!!snapshot.migrationError && (
          <div role='alert' className='flex flex-wrap items-center gap-2 p-3'>
            <span>{t('Failed to import local conversations')}</span>
            <span>{getServerErrorMessage(snapshot.migrationError)}</span>
            <Button
              variant='outline'
              size='sm'
              onClick={() => void workspace.migrate()}
            >
              {t('Retry')}
            </Button>
          </div>
        )}
        {!!snapshot.cacheError && (
          <p role='alert' className='text-destructive px-3 py-2 text-sm'>
            {getServerErrorMessage(
              snapshot.cacheError,
              t('Unable to keep unsaved conversations on this device')
            )}
          </p>
        )}
        {(!snapshot.ready || opening) && <LoadingState />}
        {!!openError && (
          <ErrorState
            description={getServerErrorMessage(
              openError,
              t('Failed to load conversations')
            )}
            onRetry={() => setRetry((value) => value + 1)}
          />
        )}
        {snapshot.ready && !opening && !openError && !current && (
          <div className='flex flex-1 items-center justify-center'>
            <Button onClick={() => void create()}>
              {t('New conversation')}
            </Button>
          </div>
        )}
        {entries.map((entry) => (
          <ConversationSession
            key={entry.key}
            entry={entry}
            workspace={workspace}
            active={entry.key === activeKey && !opening && !openError}
            onReload={() => {
              void workspace.open(entry.row.id, true).catch(setOpenError)
            }}
            onCopy={() => void create(true)}
          />
        ))}
        {dialog && current && (
          <ConversationDialogs
            key={dialog + current.key}
            action={dialog}
            title={current.row.title}
            onClose={() => setDialog(null)}
            onConfirm={async (title) => {
              if (dialog === 'rename') {
                workspace.rename(current.key, title)
                if (!(await workspace.flush(current.key))) {
                  throw (
                    workspace.getSnapshot().entries[current.key]?.error ??
                    new Error('Failed to save conversation')
                  )
                }
              } else {
                await workspace.remove(current.key)
                setActiveKey('')
                void navigate({ search: {} })
                await list.refetch()
              }
            }}
          />
        )}
      </section>
    </div>
  )
}
