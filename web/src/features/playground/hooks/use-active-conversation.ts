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
import { useQueryClient } from '@tanstack/react-query'
import { useNavigate, useSearch } from '@tanstack/react-router'
import { useCallback, useEffect, useRef, useState } from 'react'

import { getServerErrorStatus } from '@/lib/server-error-message'

import { emptyConversationDocument } from '../conversations-api'
import {
  interruptedDocument,
  type ConversationWorkspace,
} from '../lib/conversation-workspace'
import { useWorkspaceSelector } from './use-workspace'

type Options = {
  workspace: ConversationWorkspace
  owner: number
  ready: boolean
  /** The newest listed conversation, opened when the URL names none. */
  firstId?: number
  listLoaded: boolean
  keyword: string
  page: number
}

/**
 * Which conversation is open: the one the URL names, else the newest one,
 * else an unsaved blank one. Opening failures are kept until the user retries
 * or picks another conversation, so a list refresh does not flicker them.
 */
export function useActiveConversation(options: Options) {
  const { workspace, owner, ready, firstId, listLoaded, keyword, page } =
    options
  const queryClient = useQueryClient()
  const navigate = useNavigate({ from: '/playground/' })
  const search = useSearch({ from: '/_authenticated/playground/' })
  const [activeKey, setActiveKey] = useState('')
  const [opening, setOpening] = useState(false)
  const [openError, setOpenError] = useState<unknown>()
  const [retry, setRetry] = useState(0)
  const blankConversation = useRef<Promise<string | undefined> | null>(null)
  const failedOpen = useRef<{ id: number; retry: number } | null>(null)
  // The open conversation's server ID; undefined while nothing is open.
  const currentId = useWorkspaceSelector(
    workspace,
    (snapshot) => snapshot.entries[activeKey]?.row.id
  )
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
      } else if (listLoaded && !keyword && page === 1) {
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
            queryKey: ['playground-conversations', owner],
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
    owner,
    ready,
    search.conversation,
    firstId,
    navigate,
    retry,
    activeKey,
    listLoaded,
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
    async (copy = false): Promise<string | undefined> => {
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
      return key
    },
    [workspace, activeKey, navigate]
  )
  const reload = useCallback(
    (key: string) => {
      const id = workspace.getSnapshot().entries[key]?.row.id
      if (id) void workspace.open(id, true).catch(setOpenError)
    },
    [workspace]
  )
  const select = useCallback(
    (id: number) => void navigate({ search: { conversation: id } }),
    [navigate]
  )
  const selectPending = useCallback(
    (key: string) => {
      setActiveKey(key)
      void navigate({ search: {} })
    },
    [navigate]
  )
  const close = useCallback(() => {
    setActiveKey('')
    void navigate({ search: {} })
  }, [navigate])
  return {
    activeKey,
    currentId,
    hasCurrent: currentId !== undefined,
    searchConversation: search.conversation,
    opening,
    openError,
    retryOpen: () => setRetry((value) => value + 1),
    create,
    reload,
    select,
    selectPending,
    close,
  }
}
