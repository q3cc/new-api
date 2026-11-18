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
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'

import { TicketDetailView } from '../components/ticket-detail-view'
import type { TicketDetail, TicketViewer } from '../types'

let detail: TicketDetail
let posts: string[]
let replies: string[]
let replyFails: boolean
let client: QueryClient

beforeEach(() => {
  posts = []
  replies = []
  replyFails = false
  detail = {
    ticket: {
      id: 7,
      user_id: 12,
      username: 'alice',
      title: 'Top-up missing',
      category: 'billing',
      status: 'replied',
      topup_trade_no: 'T-ALICE-1',
      request_id: '',
      assignee_id: 0,
      user_unread: true,
      admin_unread: false,
      created_at: 1_700_000_000,
      updated_at: 1_700_000_100,
      closed_at: 0,
      closed_by: '',
    },
    messages: [
      {
        id: 1,
        ticket_id: 7,
        user_id: 12,
        username: 'alice',
        is_staff: false,
        content: 'Paid but <b>no</b> credit\nsecond line',
        created_at: 1_700_000_000,
        attachments: [{ id: 30, media_type: 'image/png', size: 64 }],
      },
      {
        id: 2,
        ticket_id: 7,
        user_id: 0,
        is_staff: true,
        content: 'We are checking it',
        created_at: 1_700_000_100,
        attachments: [],
      },
    ],
  }
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  vi.spyOn(api, 'get').mockImplementation(async (url) => {
    if (url === '/api/user/tickets/7' || url === '/api/ticket/7') {
      return { data: { success: true, data: detail } }
    }
    if (url === '/api/ticket/attachment/30') {
      // The image is gone or not readable by this viewer.
      throw new Error('Request failed with status code 404')
    }
    return { data: { success: true, data: { unread: 0 } } }
  })
  vi.spyOn(api, 'post').mockImplementation(async (url, body) => {
    posts.push(String(url))
    if (String(url).endsWith('/reply')) {
      replies.push(String((body as FormData).get('content')))
      return replyFails
        ? { data: { success: false, message: 'Reply rejected' } }
        : { data: { success: true, data: detail.ticket } }
    }
    detail = {
      ...detail,
      ticket: { ...detail.ticket, status: 'closed', closed_by: 'user' },
    }
    return { data: { success: true, data: null } }
  })
})

afterEach(() => {
  client.clear()
  vi.restoreAllMocks()
})

function renderTicket(viewer: TicketViewer) {
  const root = createRootRoute()
  const page = createRoute({
    getParentRoute: () => root,
    path: '/',
    component: () => <TicketDetailView viewer={viewer} ticketId={7} />,
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

it('shows posts as plain text with support anonymous to the user', async () => {
  renderTicket('user')
  const thread = await screen.findByRole('list', { name: 'Conversation' })
  const posts = within(thread).getAllByRole('listitem')
  expect(posts).toHaveLength(2)
  expect(within(posts[0]).getByText('You')).toBeInTheDocument()
  expect(within(posts[1]).getByText('Support')).toBeInTheDocument()
  // Markup in a post is text, never HTML.
  expect(thread.querySelector('b')).toBeNull()
  expect(
    within(posts[0]).getByText(/Paid but <b>no<\/b> credit/)
  ).toBeInTheDocument()
})

it('shows a notice in place of an image that cannot be loaded', async () => {
  renderTicket('user')
  expect(
    await screen.findByRole('img', { name: 'Image unavailable' })
  ).toBeInTheDocument()
})

it('closes the ticket only after confirmation, then offers no reply box', async () => {
  const user = userEvent.setup()
  renderTicket('user')
  await user.click(await screen.findByRole('button', { name: 'Close ticket' }))
  expect(posts).toEqual([])
  const dialog = await screen.findByRole('alertdialog')
  await user.click(within(dialog).getByRole('button', { name: 'Close ticket' }))
  await waitFor(() => expect(posts).toEqual(['/api/user/tickets/7/close']))
  expect(await screen.findByText(/This ticket is closed\./)).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Send reply' })).toBeNull()
  expect(screen.queryByRole('button', { name: 'Reopen' })).toBeNull()
})

it('lets support reopen a closed ticket and see the owner', async () => {
  detail = {
    ...detail,
    ticket: { ...detail.ticket, status: 'closed', closed_by: 'system' },
  }
  renderTicket('staff')
  expect(
    await screen.findByText(
      'This ticket was closed automatically after 7 days without a reply.'
    )
  ).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'alice (#12)' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Reopen' })).toBeEnabled()
  expect(screen.getByRole('button', { name: 'T-ALICE-1' })).toBeEnabled()
})

it('sends the reply on Enter and empties the composer', async () => {
  const user = userEvent.setup()
  renderTicket('user')
  const box = await screen.findByRole('textbox', { name: 'Reply' })
  await user.type(box, 'Still not credited{Enter}')
  await waitFor(() => expect(replies).toEqual(['Still not credited']))
  await waitFor(() => expect(box).toHaveValue(''))
})

it('keeps the typed text when the reply is rejected', async () => {
  replyFails = true
  const user = userEvent.setup()
  renderTicket('user')
  const box = await screen.findByRole('textbox', { name: 'Reply' })
  await user.type(box, 'Please check again')
  await user.click(screen.getByRole('button', { name: 'Send reply' }))
  await waitFor(() => expect(replies).toEqual(['Please check again']))
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Send reply' })).toBeEnabled()
  )
  expect(box).toHaveValue('Please check again')
})

it('refuses an empty reply without sending it', async () => {
  const user = userEvent.setup()
  renderTicket('user')
  await user.click(await screen.findByRole('button', { name: 'Send reply' }))
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Message content is required'
  )
  expect(screen.getByRole('textbox', { name: 'Reply' })).toHaveAttribute(
    'aria-invalid',
    'true'
  )
  expect(posts).toEqual([])
})
