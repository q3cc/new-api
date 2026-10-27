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
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createInstance } from 'i18next'
import { I18nextProvider, initReactI18next } from 'react-i18next'
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  expect,
  it,
  vi,
} from 'vitest'

import { NotificationPopover } from '@/components/notification-popover'
import { useNotifications } from '@/hooks/use-notifications'
import zh from '@/i18n/locales/zh.json'
import { api } from '@/lib/api'
import { useAuthStore } from '@/stores/auth-store'

const i18n = createInstance()

// jsdom lacks the Web Animations API the popover's scroll area waits on.
const getAnimationsDescriptor = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  'getAnimations'
)

beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'getAnimations', {
    configurable: true,
    value: () => [],
  })
})

afterAll(() => {
  if (getAnimationsDescriptor) {
    Object.defineProperty(
      HTMLElement.prototype,
      'getAnimations',
      getAnimationsDescriptor
    )
  } else {
    Reflect.deleteProperty(HTMLElement.prototype, 'getAnimations')
  }
})

beforeEach(async () => {
  await i18n.use(initReactI18next).init({
    lng: 'zh',
    fallbackLng: false,
    nsSeparator: false,
    resources: { zh },
    interpolation: { escapeValue: false },
  })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  useAuthStore.getState().auth.reset()
  localStorage.clear()
})

const messages = [
  {
    id: 2,
    title: 'Invitation restored',
    content:
      'Your invitation relationship with {{name}} (ID: {{id}}) has been restored.',
    params: { name: 'Inviter Nick', id: 7 },
    read_at: 0,
    created_at: Math.floor(Date.now() / 1000) - 60,
  },
  {
    id: 1,
    title: 'Invitation cancelled',
    content:
      'Your invitation relationship with {{name}} (ID: {{id}}) has been cancelled.',
    params: { name: 'Inviter Nick', id: 7 },
    read_at: 0,
    created_at: Math.floor(Date.now() / 1000) - 3600,
  },
]

function Bell() {
  const notifications = useNotifications()
  return (
    <NotificationPopover
      open={notifications.popoverOpen}
      onOpenChange={notifications.setPopoverOpen}
      unreadCount={notifications.unreadCount}
      activeTab={notifications.activeTab}
      onTabChange={notifications.setActiveTab}
      notice={notifications.notice}
      announcements={notifications.announcements}
      messages={notifications.messages}
      showMessages={notifications.messagesEnabled}
      loading={notifications.loading}
    />
  )
}

function renderBell() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <I18nextProvider i18n={i18n}>
        <Bell />
      </I18nextProvider>
    </QueryClientProvider>
  )
}

function serve() {
  const get = vi.spyOn(api, 'get').mockImplementation(async (url) => {
    if (url === '/api/user/messages') {
      return {
        data: {
          success: true,
          data: {
            unread: 2,
            page: { page: 1, page_size: 20, total: 2, items: messages },
          },
        },
      }
    }
    if (url === '/api/notice') return { data: { success: true, data: '' } }
    return { data: { success: true, data: {} } }
  })
  const post = vi
    .spyOn(api, 'post')
    .mockResolvedValue({ data: { success: true } })
  return { get, post }
}

it('counts unread personal messages on the bell, opens on them and marks them read', async () => {
  useAuthStore.getState().auth.setUser({ id: 9, username: 'invitee', role: 1 })
  const { post } = serve()
  renderBell()

  const bell = screen.getByRole('button', { name: '通知' })
  await waitFor(() => expect(bell).toHaveTextContent('2'))
  await userEvent.click(bell)

  expect(await screen.findByRole('tab', { name: /消息/ })).toHaveAttribute(
    'aria-selected',
    'true'
  )
  expect(screen.getByText('邀请已恢复')).toBeVisible()
  expect(
    screen.getByText('你与 Inviter Nick（ID: 7）的邀请关系已被取消。')
  ).toBeVisible()
  await waitFor(() =>
    expect(post).toHaveBeenCalledWith('/api/user/messages/read')
  )
  await waitFor(() => expect(bell).not.toHaveTextContent('2'))
})

it('does not load personal messages for a signed-out visitor', async () => {
  const { get } = serve()
  renderBell()

  await userEvent.click(screen.getByRole('button', { name: '通知' }))

  expect(await screen.findByRole('tab', { name: /通知/ })).toBeVisible()
  expect(screen.queryByRole('tab', { name: /消息/ })).not.toBeInTheDocument()
  expect(get).not.toHaveBeenCalledWith('/api/user/messages', expect.anything())
})
