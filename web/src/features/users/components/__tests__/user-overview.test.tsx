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
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { api, type ApiRequestConfig } from '@/lib/api'
import { ROLE } from '@/lib/roles'
import { useAuthStore } from '@/stores/auth-store'

import { UserOverview } from '../user-overview'

const account = {
  id: 12,
  username: 'alice',
  display_name: 'Alice Chen',
  email: 'alice@example.com',
  quota: 1_000_000,
  used_quota: 500_000,
  request_count: 42,
  group: 'default',
  role: 1,
  status: 1,
  created_at: 1_700_000_000,
  last_login_at: 1_700_100_000,
}
const order = {
  id: 3,
  user_id: 12,
  username: 'alice',
  trade_no: 'T-ALICE-9',
  order_type: 'topup',
  amount: 10,
  money: 73,
  payment_method: 'alipay',
  status: 'success',
  create_time: 1_700_050_000,
}
let userResponse: { success: boolean; message?: string; data?: unknown }
let requested: { url: string; params?: Record<string, unknown> }[]
let client: QueryClient

beforeEach(() => {
  userResponse = { success: true, data: account }
  requested = []
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  useAuthStore
    .getState()
    .auth.setUser({ id: 1, username: 'root', role: ROLE.SUPER_ADMIN })
  vi.spyOn(api, 'get').mockImplementation(
    async (url, config?: ApiRequestConfig) => {
      requested.push({ url, params: config?.params })
      switch (url) {
        case '/api/user/12':
          return { data: userResponse }
        case '/api/user/12/gift-quota':
          return {
            data: {
              success: true,
              data: {
                total: 500_000,
                items: [{ source: 'registration', quota: 500_000 }],
              },
            },
          }
        case '/api/user/topup':
          return { data: { success: true, data: { items: [order], total: 1 } } }
        case '/api/user/topup/detail':
          return {
            data: {
              success: true,
              data: { ...order, display_name: 'Alice Chen', email: '' },
            },
          }
        case '/api/ticket/':
          return { data: { success: true, data: { items: [], total: 3 } } }
      }
      throw new Error(`Unexpected endpoint: ${url}`)
    }
  )
})

afterEach(() => {
  client.clear()
  vi.restoreAllMocks()
  useAuthStore.getState().auth.setUser(null)
})

function renderOverview(props: { showUsersLink?: boolean } = {}) {
  const root = createRootRoute()
  const page = createRoute({
    getParentRoute: () => root,
    path: '/',
    component: () => (
      <UserOverview userId={12} showUsersLink={props.showUsersLink} />
    ),
  })
  const router = createRouter({
    routeTree: root.addChildren([page]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  )
}

it('shows the account with balance, gift credit and the five latest orders', async () => {
  renderOverview()

  expect(await screen.findByText('Alice Chen')).toBeInTheDocument()
  expect(screen.getByText('alice@example.com')).toBeInTheDocument()
  expect(
    await screen.findByRole('button', { name: 'Gift credit received: $1' })
  ).toBeInTheDocument()
  expect(
    await screen.findByRole('button', { name: /T-ALICE-9/ })
  ).toBeInTheDocument()
  expect(
    requested.find((r) => r.url === '/api/user/topup')?.params
  ).toMatchObject({ user_id: 12, p: 1, page_size: 5 })
})

it('opens the order details from a recent order', async () => {
  renderOverview()

  await userEvent
    .setup()
    .click(await screen.findByRole('button', { name: /T-ALICE-9/ }))

  const dialog = await screen.findByRole('dialog', { name: 'Order details' })
  expect(
    requested.find((r) => r.url === '/api/user/topup/detail')?.params
  ).toMatchObject({ trade_no: 'T-ALICE-9' })
  expect(within(dialog).getAllByText('T-ALICE-9').length).toBeGreaterThan(0)
})

it("links to the user's orders, logs, tickets and user management", async () => {
  renderOverview()

  const links = await screen.findByRole('navigation', { name: 'Quick links' })
  expect(
    await within(links).findByRole('link', { name: 'Tickets (3)' })
  ).toHaveAttribute('href', '/tickets/manage?user_id=12')
  expect(
    await within(links).findByRole('link', { name: 'Usage Logs' })
  ).toHaveAttribute('href', '/usage-logs/common?username=alice')
  expect(
    within(links).getByRole('link', { name: 'Open in user management' })
  ).toHaveAttribute('href', '/users?filter=alice')
  expect(screen.getByRole('link', { name: 'All orders' })).toHaveAttribute(
    'href',
    '/orders?user_id=12'
  )
})

it('leaves out the user management link on the users page', async () => {
  renderOverview({ showUsersLink: false })

  await screen.findByText('Alice Chen')
  expect(
    screen.queryByRole('link', { name: 'Open in user management' })
  ).toBeNull()
})

it('still lists orders and tickets when the account itself may not be viewed', async () => {
  userResponse = {
    success: false,
    message: 'No permission to access users of same or higher level',
  }
  renderOverview()

  expect(
    await screen.findByText(
      'No permission to access users of same or higher level'
    )
  ).toBeInTheDocument()
  expect(
    await screen.findByRole('button', { name: /T-ALICE-9/ })
  ).toBeInTheDocument()
  expect(
    await screen.findByRole('link', { name: 'Tickets (3)' })
  ).toBeInTheDocument()
  // The log and user searches need the login name, which only the account
  // carries.
  expect(screen.queryByRole('link', { name: 'Usage Logs' })).toBeNull()
  expect(
    screen.queryByRole('link', { name: 'Open in user management' })
  ).toBeNull()
  expect(requested.some((r) => r.url === '/api/user/12/gift-quota')).toBe(false)
})

it('neither loads nor links tickets for an admin without ticket access', async () => {
  useAuthStore
    .getState()
    .auth.setUser({ id: 2, username: 'agent', role: ROLE.ADMIN })
  renderOverview()

  await screen.findByRole('button', { name: /T-ALICE-9/ })
  expect(screen.queryByRole('link', { name: /Tickets/ })).toBeNull()
  expect(requested.some((r) => r.url === '/api/ticket/')).toBe(false)
})
