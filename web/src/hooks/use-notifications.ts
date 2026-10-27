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
import { useState, useMemo } from 'react'

import { useStatus } from '@/hooks/use-status'
import { getNotice, getUserMessages, readUserMessages } from '@/lib/api'
import { requireServerSuccess } from '@/lib/server-error-message'
import { useAuthStore } from '@/stores/auth-store'
import { useNotificationStore } from '@/stores/notification-store'

export type NotificationTab = 'notice' | 'announcements' | 'messages'

const USER_MESSAGES_KEY = ['user-messages'] as const

function hashString(input: string): string {
  let hash = 0
  if (!input) return '0'

  for (let i = 0; i < input.length; i += 1) {
    const chr = input.charCodeAt(i)
    hash = (hash << 5) - hash + chr
    hash |= 0
  }

  return hash.toString(36)
}

/**
 * Generate a unique key for an announcement
 * Prefer backend id, fall back to a content hash so edits register
 */
function getAnnouncementKey(item: Record<string, unknown>): string {
  if (!item) return ''

  if (item.id !== undefined && item.id !== null) {
    return `id:${item.id}`
  }

  const fingerprint = JSON.stringify({
    publishDate: (item?.publishDate as string) || '',
    content: ((item?.content as string) || '').trim(),
    extra: ((item?.extra as string) || '').trim(),
    type: (item?.type as string) || '',
    title: ((item?.title as string) || '').trim(),
    link: ((item?.link as string) || '').trim(),
  })
  return `hash:${hashString(fingerprint)}`
}

/**
 * Hook to manage notifications (Notice + Announcements + personal Messages)
 * Provides unread counts and read status management
 */
export function useNotifications() {
  const queryClient = useQueryClient()
  const [popoverOpen, setPopoverOpen] = useState(false)
  const [activeTab, setActiveTab] = useState<NotificationTab>('notice')

  // Personal messages belong to the signed-in user; the server keeps their
  // read state, so they are polled rather than tracked in this browser.
  const userId = useAuthStore((s) => s.auth.user?.id)
  const messagesEnabled = userId !== undefined
  const { data: messagesData, isLoading: messagesLoading } = useQuery({
    queryKey: [...USER_MESSAGES_KEY, userId],
    queryFn: async () => requireServerSuccess(await getUserMessages()).data,
    enabled: messagesEnabled,
    refetchInterval: 60_000,
    meta: { errorToast: false },
  })
  const messages = messagesData?.page.items ?? []
  const unreadMessages = messagesEnabled ? (messagesData?.unread ?? 0) : 0

  // Fetch Notice from API
  const {
    data: noticeResponse,
    isLoading: noticeLoading,
    refetch: refetchNotice,
  } = useQuery({
    queryKey: ['notice'],
    queryFn: async () => requireServerSuccess(await getNotice()),
    staleTime: 1000 * 60 * 5, // 5 minutes
  })

  // Fetch Announcements from status
  const { status, loading: statusLoading } = useStatus()
  const announcementsEnabled = status?.announcements_enabled ?? false
  const announcements = useMemo<Record<string, unknown>[]>(() => {
    if (!announcementsEnabled) return []
    return ((status?.announcements || []) as Record<string, unknown>[]).slice(
      0,
      20
    )
  }, [announcementsEnabled, status?.announcements])

  // Notification store
  const {
    lastReadNotice,
    markNoticeRead,
    markAnnouncementsRead,
    isAnnouncementRead,
  } = useNotificationStore()

  // Extract notice content
  const noticeContent = noticeResponse?.success
    ? (noticeResponse.data || '').trim()
    : ''

  // Calculate unread counts
  const unreadCounts = useMemo(() => {
    const noticeUnread =
      noticeContent && noticeContent !== lastReadNotice ? 1 : 0

    const announcementsUnread = announcements.filter(
      (item: Record<string, unknown>) => {
        const key = getAnnouncementKey(item)
        return !isAnnouncementRead(key)
      }
    ).length

    return {
      notice: noticeUnread,
      announcements: announcementsUnread,
      total: noticeUnread + announcementsUnread + unreadMessages,
    }
  }, [
    noticeContent,
    lastReadNotice,
    announcements,
    isAnnouncementRead,
    unreadMessages,
  ])

  // The list keeps showing which messages were new until the next refresh.
  const markMessagesAsRead = () => {
    if (unreadMessages === 0) return
    readUserMessages()
      .then(() =>
        queryClient.setQueryData(
          [...USER_MESSAGES_KEY, userId],
          (old: typeof messagesData) => old && { ...old, unread: 0 }
        )
      )
      .catch(() => {})
  }

  const markAnnouncementsAsRead = () => {
    if (announcements.length > 0) {
      const allKeys = announcements.map((item: Record<string, unknown>) =>
        getAnnouncementKey(item)
      )
      markAnnouncementsRead(allKeys)
    }
  }

  // Handle popover open; unread personal messages are shown first
  const handleOpenPopover = (tab?: NotificationTab) => {
    const nextTab = tab || (unreadMessages > 0 ? 'messages' : activeTab)

    // Mark currently visible content as read when opening the notification center
    if (noticeContent) {
      markNoticeRead(noticeContent)
    }
    if (nextTab === 'announcements') {
      markAnnouncementsAsRead()
    }
    if (nextTab === 'messages') {
      markMessagesAsRead()
    }

    setActiveTab(nextTab)
    setPopoverOpen(true)
  }

  const handlePopoverOpenChange = (open: boolean) => {
    if (open) {
      handleOpenPopover()
      return
    }

    setPopoverOpen(false)
  }

  // Handle tab change - mark a tab's items as read when switching to it
  const handleTabChange = (tab: NotificationTab) => {
    setActiveTab(tab)

    if (tab === 'announcements') {
      markAnnouncementsAsRead()
    }
    if (tab === 'messages') {
      markMessagesAsRead()
    }
  }

  return {
    // Data
    notice: noticeContent,
    announcements,
    messages,
    messagesEnabled,
    loading: noticeLoading || statusLoading,
    messagesLoading,

    // Unread counts
    unreadCount: unreadCounts.total,
    unreadNoticeCount: unreadCounts.notice,
    unreadAnnouncementsCount: unreadCounts.announcements,

    // Popover state
    popoverOpen,
    setPopoverOpen: handlePopoverOpenChange,
    activeTab,
    setActiveTab: handleTabChange,

    // Actions
    openPopover: handleOpenPopover,
    closePopover: () => setPopoverOpen(false),
    refetchNotice,
  }
}
