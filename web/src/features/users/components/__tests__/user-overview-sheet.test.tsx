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

import { api } from '@/lib/api'

import type { User } from '../../types'
import { UserOverviewSheet } from '../user-overview-sheet'
import { UsernameButton } from '../username-button'
import { UsersProvider, useUsers } from '../users-provider'

const target: User = {
  id: 12,
  username: 'alice',
  display_name: 'Alice Chen',
  role: 1,
  status: 1,
  quota: 0,
  used_quota: 0,
  request_count: 0,
  group: 'default',
}
let client: QueryClient

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  vi.spyOn(api, 'get').mockImplementation(async (url) => {
    if (url === '/api/user/12') {
      return { data: { success: true, data: target } }
    }
    if (url === '/api/user/topup') {
      return { data: { success: true, data: { items: [], total: 0 } } }
    }
    return { data: { success: true, data: { total: 0, items: [] } } }
  })
})

afterEach(() => {
  client.clear()
  vi.restoreAllMocks()
})

/** Shows which users dialog the provider has open. */
function OpenDialog() {
  return <output aria-label='Open dialog'>{useUsers().open ?? ''}</output>
}

function renderUsers() {
  const root = createRootRoute()
  const page = createRoute({
    getParentRoute: () => root,
    path: '/',
    component: () => (
      <UsersProvider>
        <UsernameButton user={target} />
        <UserOverviewSheet />
        <OpenDialog />
      </UsersProvider>
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

it("clicking a username opens that user's overview without the link back to the users page", async () => {
  renderUsers()

  await userEvent
    .setup()
    .click(await screen.findByRole('button', { name: 'alice' }))

  const sheet = await screen.findByRole('dialog', { name: 'User overview' })
  expect(await within(sheet).findByText('Alice Chen')).toBeInTheDocument()
  expect(
    within(sheet).queryByRole('link', { name: 'Open in user management' })
  ).toBeNull()
})

it('the overview hands over to the edit drawer for the same user', async () => {
  const user = userEvent.setup()
  renderUsers()
  await user.click(await screen.findByRole('button', { name: 'alice' }))
  const sheet = await screen.findByRole('dialog', { name: 'User overview' })

  await user.click(within(sheet).getByRole('button', { name: 'Edit' }))

  expect(screen.getByRole('status', { name: 'Open dialog' })).toHaveTextContent(
    'update'
  )
})
