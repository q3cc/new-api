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
  Outlet,
  RouterProvider,
} from '@tanstack/react-router'
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { afterEach, expect, it, vi } from 'vitest'

import { Button } from '@/components/ui/button'
import { TooltipProvider } from '@/components/ui/tooltip'
import { api } from '@/lib/api'

import { UserInviteesDialog } from '../user-invitees-dialog'

const clients: QueryClient[] = []
const i18n = createInstance()
await i18n.init({
  lng: 'en',
  resources: { en: { translation: {} } },
  initAsync: false,
})

function renderDialog() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  clients.push(client)
  const root = createRootRoute({
    component: () => (
      <>
        <UserInviteesDialog
          userId={1}
          username='admin'
          trigger={<Button variant='link'>Invited 2 users</Button>}
        />
        <Outlet />
      </>
    ),
  })
  const users = createRoute({
    getParentRoute: () => root,
    path: '/users',
    validateSearch: (search: Record<string, unknown>) => search,
  })
  const router = createRouter({
    routeTree: root.addChildren([users]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })
  render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={client}>
        <TooltipProvider>
          <RouterProvider router={router} />
        </TooltipProvider>
      </QueryClientProvider>
    </I18nextProvider>
  )
  return router
}

afterEach(() => {
  cleanup()
  clients.splice(0).forEach((client) => client.clear())
  vi.restoreAllMocks()
})

it('loads invitees only after the invite info is clicked and lists them', async () => {
  const get = vi.spyOn(api, 'get').mockResolvedValue({
    data: {
      success: true,
      data: {
        items: [
          {
            id: 12,
            username: 'alice',
            display_name: 'Alice',
            status: 1,
            created_at: 1_790_000_000,
            risk_score: {
              score: 62,
              shared_ip_users: 5,
              same_subnet_users: 1,
              ip_count: 8,
              updated_at: 1_790_000_000,
            },
          },
          {
            id: 11,
            username: 'bob',
            display_name: '',
            status: 2,
            created_at: 1_789_000_000,
          },
        ],
        total: 2,
      },
    },
  })
  renderDialog()
  expect(get).not.toHaveBeenCalled()

  await userEvent.click(
    await screen.findByRole('button', { name: 'Invited 2 users' })
  )

  const list = await screen.findByRole('list', { name: 'Invited users' })
  const items = within(list).getAllByRole('listitem')
  expect(get).toHaveBeenCalledWith('/api/user/1/invitees')
  expect(items).toHaveLength(2)
  expect(within(items[0]).getByText('alice')).toBeInTheDocument()
  expect(within(items[0]).getByText('Alice')).toBeInTheDocument()
  expect(within(items[0]).getByText('Enabled')).toBeInTheDocument()
  expect(within(items[1]).getByText('Disabled')).toBeInTheDocument()
  expect(within(items[0]).getByLabelText('Risk score 62')).toHaveTextContent(
    '62'
  )
  expect(within(items[1]).getByLabelText('Risk score 0')).toBeInTheDocument()
  expect(screen.queryByText(/Showing the latest/)).not.toBeInTheDocument()
})

it('notes truncation when the inviter has more invitees than returned', async () => {
  vi.spyOn(api, 'get').mockResolvedValue({
    data: {
      success: true,
      data: {
        items: [
          {
            id: 12,
            username: 'alice',
            display_name: '',
            status: 1,
            created_at: 1,
          },
        ],
        total: 150,
      },
    },
  })
  renderDialog()

  await userEvent.click(
    await screen.findByRole('button', { name: 'Invited 2 users' })
  )

  expect(
    await screen.findByText('Showing the latest 1 of 150 invited users')
  ).toBeInTheDocument()
})

it('shows an empty message when the inviter has no live invitees', async () => {
  vi.spyOn(api, 'get').mockResolvedValue({
    data: { success: true, data: { items: [], total: 0 } },
  })
  renderDialog()

  await userEvent.click(
    await screen.findByRole('button', { name: 'Invited 2 users' })
  )

  expect(await screen.findByText('No invited users')).toBeInTheDocument()
})

it('opens the user management list filtered to an invitee when its username is clicked', async () => {
  vi.spyOn(api, 'get').mockResolvedValue({
    data: {
      success: true,
      data: {
        items: [
          {
            id: 12,
            username: 'alice',
            display_name: '',
            status: 1,
            created_at: 1,
          },
        ],
        total: 1,
      },
    },
  })
  const router = renderDialog()
  await userEvent.click(
    await screen.findByRole('button', { name: 'Invited 2 users' })
  )

  await userEvent.click(await screen.findByRole('link', { name: 'alice' }))

  await waitFor(() => expect(router.state.location.pathname).toBe('/users'))
  expect(router.state.location.search).toEqual({ filter: 'alice' })
  await waitFor(() =>
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  )
})
