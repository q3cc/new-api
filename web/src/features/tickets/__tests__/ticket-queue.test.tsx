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
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { api, type ApiRequestConfig } from '@/lib/api'

import { ticketQueueSearchSchema, type TicketQueueSearch } from '../api'
import { TicketQueuePage } from '../ticket-queue'
import type { Ticket } from '../types'

const ticket: Ticket = {
  id: 7,
  user_id: 12,
  username: 'alice',
  title: 'Top-up missing',
  category: 'billing',
  status: 'open',
  priority: 'normal',
  topup_trade_no: '',
  request_id: '',
  assignee_id: 0,
  user_unread: false,
  admin_unread: true,
  created_at: 1_700_000_000,
  updated_at: 1_700_000_100,
  waiting_since: 1_700_000_000,
  first_replied_at: 0,
  closed_at: 0,
  closed_by: '',
  rating: 0,
  rating_comment: '',
  rated_at: 0,
}
let requests: Record<string, unknown>[]
let client: QueryClient

beforeEach(() => {
  requests = []
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  vi.spyOn(api, 'get').mockImplementation(
    async (url, config?: ApiRequestConfig) => {
      if (url !== '/api/ticket/') throw new Error(`Unexpected endpoint: ${url}`)
      requests.push(config?.params)
      return { data: { success: true, data: { items: [ticket], total: 1 } } }
    }
  )
})

afterEach(() => {
  client.clear()
  vi.restoreAllMocks()
})

function QueueHarness() {
  const [search, setSearch] = useState<TicketQueueSearch>({})
  return (
    <TicketQueuePage
      search={search}
      navigate={({ search: next }) =>
        setSearch((prev) => {
          if (next === true) return prev
          return ticketQueueSearchSchema.parse(
            typeof next === 'function' ? next(prev) : next
          )
        })
      }
    />
  )
}

function renderQueue() {
  const root = createRootRoute()
  const page = createRoute({
    getParentRoute: () => root,
    path: '/',
    component: QueueHarness,
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

it("clicking a ticket's user narrows the queue to that user, and the chip clears it", async () => {
  const user = userEvent.setup()
  renderQueue()

  await user.click(
    await screen.findByRole('button', { name: 'Show tickets of alice' })
  )

  await waitFor(() => expect(requests.at(-1)).toMatchObject({ user_id: 12 }))
  await user.click(screen.getByRole('button', { name: 'User #12 ×' }))
  await waitFor(() => expect(requests.at(-1)?.user_id).toBeUndefined())
})
