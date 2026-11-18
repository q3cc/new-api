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
import { useTranslation } from 'react-i18next'

import { toIntlLocale } from '@/i18n/languages'
import { formatNumber } from '@/lib/format'
import { ROLE } from '@/lib/roles'
import { useAuthStore } from '@/stores/auth-store'

import { getTicketSummary, getUserTicketUnread, ticketKeys } from '../api'

const BADGE_REFRESH_MS = 60_000

/**
 * Sidebar counts: tickets with a support reply the user has not opened, and
 * for administrators the tickets waiting for support. A count of zero, or
 * one that failed to load, shows no badge.
 */
export function useTicketSidebarBadges(): {
  tickets?: string
  ticketQueue?: string
  ticketQueueOverdue?: boolean
} {
  const { i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const role = useAuthStore((s) => s.auth.user?.role ?? ROLE.GUEST)
  const unread = useQuery({
    queryKey: ticketKeys.userUnread,
    queryFn: ({ signal }) => getUserTicketUnread(signal),
    enabled: role >= ROLE.USER,
    refetchInterval: BADGE_REFRESH_MS,
    retry: false,
    meta: { errorToast: false },
  })
  const summary = useQuery({
    queryKey: ticketKeys.summary,
    queryFn: ({ signal }) => getTicketSummary(signal),
    enabled: role >= ROLE.ADMIN,
    refetchInterval: BADGE_REFRESH_MS,
    retry: false,
    meta: { errorToast: false },
  })
  const format = (count?: number) =>
    count ? formatNumber(count, locale) : undefined
  return {
    tickets: format(unread.data),
    ticketQueue: format(summary.data?.open),
    ticketQueueOverdue: (summary.data?.overdue ?? 0) > 0,
  }
}
