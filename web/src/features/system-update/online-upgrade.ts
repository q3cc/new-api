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
import { useQuery } from '@tanstack/react-query'
import { useSyncExternalStore } from 'react'

import { api } from '@/lib/api'
import { ROLE } from '@/lib/roles'
import { requireServerSuccess } from '@/lib/server-error-message'
import { useAuthStore } from '@/stores/auth-store'

import {
  subscribeSystemUpdatePreferences,
  useSystemUpdatePreferencesStore,
} from './store'

type Envelope<T> = { success: boolean; message?: string; data: T }

export type OnlineUpgradeRelease = {
  version: string
  notes: string
  url: string
  published_at: number
}

export type OnlineUpgradeWorker = {
  generation: number
  pid: number
  version: string
  started_at: number
  draining_since?: number
  connections: number
}

export type OnlineUpgradeStatus = {
  supervised: boolean
  current_version: string
  /** Seconds the previous version may keep serving its connections. */
  drain_timeout: number
  check: {
    latest?: OnlineUpgradeRelease
    has_update: boolean
    checked_at: number
    error?: string
  }
  /**
   * Whether this user may install or roll back. Administrators below root
   * only see whether a new version exists.
   */
  can_upgrade: boolean
  /** This server's part: downloading and verifying the new binary. */
  progress: {
    phase?: 'downloading' | 'handing_over' | 'handed_over' | 'failed'
    version?: string
    error?: string
    downloaded: number
    total: number
  }
  /** The supervisor's part: starting the new version and draining the old. */
  supervisor?: {
    phase: 'idle' | 'starting' | 'succeeded' | 'failed'
    target_version?: string
    error?: string
    draining: OnlineUpgradeWorker[]
    previous?: { version: string }
  }
}

export const onlineUpgradeQueryKey = ['system-upgrade', 'status'] as const

export async function getOnlineUpgradeStatus(signal?: AbortSignal) {
  const response = await api.get<Envelope<OnlineUpgradeStatus>>(
    '/api/system-upgrade/status',
    { signal }
  )
  return requireServerSuccess(response.data).data
}

export async function checkOnlineUpgrade() {
  const response = await api.post<Envelope<OnlineUpgradeStatus['check']>>(
    '/api/system-upgrade/check'
  )
  return requireServerSuccess(response.data).data
}

export async function applyOnlineUpgrade(version: string, proofToken: string) {
  const response = await api.post<Envelope<null>>(
    '/api/system-upgrade/apply',
    { version },
    { headers: { 'X-Security-Proof': proofToken } }
  )
  return requireServerSuccess(response.data)
}

export async function rollbackOnlineUpgrade(proofToken: string) {
  const response = await api.post<Envelope<null>>(
    '/api/system-upgrade/rollback',
    {},
    { headers: { 'X-Security-Proof': proofToken } }
  )
  return requireServerSuccess(response.data)
}

/** Whether an upgrade is running, so the status is polled closely. */
export function isUpgradeInProgress(status?: OnlineUpgradeStatus) {
  if (!status?.progress) return false
  const phase = status.progress.phase
  return (
    phase === 'downloading' ||
    phase === 'handing_over' ||
    status.supervisor?.phase === 'starting' ||
    (status.supervisor?.draining?.length ?? 0) > 0
  )
}

/**
 * The server's release check and upgrade status. Every administrator sees
 * whether a new version exists; only root may install it.
 */
export function useOnlineUpgradeStatus() {
  const isAdmin = useAuthStore(
    (state) => (state.auth.user?.role ?? 0) >= ROLE.ADMIN
  )
  return useQuery({
    queryKey: onlineUpgradeQueryKey,
    queryFn: ({ signal }) => getOnlineUpgradeStatus(signal),
    enabled: isAdmin,
    refetchInterval: (query) =>
      isUpgradeInProgress(query.state.data) ? 2_000 : 60_000,
    meta: { errorToast: false },
  })
}

/**
 * The newest release this administrator should hear about, honouring the
 * versions they chose to ignore.
 */
export function useUpdateNotice() {
  const user = useAuthStore((state) => state.auth.user)
  const query = useOnlineUpgradeStatus()
  const status = query.data
  const latest = status?.check.has_update ? status.check.latest : undefined
  const isIgnored = useSyncExternalStore(subscribeSystemUpdatePreferences, () =>
    Boolean(
      user &&
      latest &&
      useSystemUpdatePreferencesStore
        .getState()
        .ignoredVersionsByUserId[user.id]?.includes(latest.version)
    )
  )

  const setIgnored = (ignored: boolean) => {
    if (!user || !latest) return
    useSystemUpdatePreferencesStore
      .getState()
      .setVersionIgnored(user.id, latest.version, ignored)
  }

  return {
    status,
    latest,
    isIgnored,
    notify: Boolean(latest) && !isIgnored,
    setIgnored,
  }
}
