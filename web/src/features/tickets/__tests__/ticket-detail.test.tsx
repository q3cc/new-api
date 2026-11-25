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
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'
import { ROLE } from '@/lib/roles'
import { useAuthStore } from '@/stores/auth-store'

import { ticketKeys } from '../api'
import { TicketDetailView } from '../components/ticket-detail-view'
import type { TicketDetail, TicketViewer } from '../types'

let detail: TicketDetail
let posts: string[]
let sent: { content: string; internal: string | null }[]
let ratings: unknown[]
let replyFails: boolean
let client: QueryClient

beforeEach(() => {
  posts = []
  sent = []
  ratings = []
  replyFails = false
  detail = {
    ticket: {
      id: 7,
      user_id: 12,
      username: 'alice',
      title: 'Top-up missing',
      category: 'billing',
      status: 'replied',
      priority: 'normal',
      topup_trade_no: 'T-ALICE-1',
      request_id: '',
      assignee_id: 0,
      user_unread: true,
      admin_unread: false,
      created_at: 1_700_000_000,
      updated_at: 1_700_000_100,
      waiting_since: 1_700_000_000,
      first_replied_at: 1_700_000_100,
      closed_at: 0,
      closed_by: '',
      rating: 0,
      rating_comment: '',
      rated_at: 0,
    },
    messages: [
      {
        id: 1,
        ticket_id: 7,
        user_id: 12,
        username: 'alice',
        is_staff: false,
        kind: '',
        content: 'Paid but <b>no</b> credit\nsecond line',
        created_at: 1_700_000_000,
        attachments: [{ id: 30, media_type: 'image/png', size: 64 }],
      },
      {
        id: 2,
        ticket_id: 7,
        user_id: 0,
        is_staff: true,
        kind: '',
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
    if (url === '/api/ticket/canned-replies') {
      return {
        data: {
          success: true,
          data: [
            {
              id: 1,
              title: 'Refund',
              content: 'We refunded your order.',
              updated_at: 1,
            },
          ],
        },
      }
    }
    return { data: { success: true, data: { unread: 0 } } }
  })
  vi.spyOn(api, 'post').mockImplementation(async (url, body) => {
    posts.push(String(url))
    if (String(url).endsWith('/reply')) {
      const form = body as FormData
      sent.push({
        content: String(form.get('content')),
        internal: form.get('internal') as string | null,
      })
      return replyFails
        ? { data: { success: false, message: 'Reply rejected' } }
        : { data: { success: true, data: detail.ticket } }
    }
    if (String(url).endsWith('/rate')) {
      ratings.push(body)
      detail = {
        ...detail,
        ticket: {
          ...detail.ticket,
          rating: 4,
          rating_comment: 'Quick',
          rated_at: 1_700_000_500,
        },
      }
      return { data: { success: true, data: null } }
    }
    detail = {
      ...detail,
      ticket: String(url).endsWith('/reopen')
        ? { ...detail.ticket, status: 'open', closed_by: '' }
        : { ...detail.ticket, status: 'closed', closed_by: 'user' },
    }
    return { data: { success: true, data: null } }
  })
})

afterEach(() => {
  client.clear()
  vi.restoreAllMocks()
  useAuthStore.getState().auth.setUser(null)
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

it('closes the ticket only after confirmation, then lets the owner reopen it', async () => {
  const user = userEvent.setup()
  renderTicket('user')
  await user.click(await screen.findByRole('button', { name: 'Close ticket' }))
  expect(posts).toEqual([])
  const dialog = await screen.findByRole('alertdialog')
  await user.click(within(dialog).getByRole('button', { name: 'Close ticket' }))
  await waitFor(() => expect(posts).toEqual(['/api/user/tickets/7/close']))
  expect(await screen.findByText('This ticket is closed.')).toBeInTheDocument()
  expect(
    screen.getByText('Reopen it if you still need help.')
  ).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Send reply' })).toBeNull()

  await user.click(screen.getByRole('button', { name: 'Reopen' }))
  const confirm = await screen.findByRole('alertdialog')
  await user.click(within(confirm).getByRole('button', { name: 'Reopen' }))
  await waitFor(() =>
    expect(posts).toEqual([
      '/api/user/tickets/7/close',
      '/api/user/tickets/7/reopen',
    ])
  )
  expect(
    await screen.findByRole('button', { name: 'Send reply' })
  ).toBeInTheDocument()
})

it('warns only the owner that a support reply closes the ticket in 30 minutes', async () => {
  renderTicket('user')
  expect(
    await screen.findByText(/within 30 minutes of the last support reply/)
  ).toBeInTheDocument()
  client.clear()
})

it('does not show support the owner-side 30-minute warning', async () => {
  renderTicket('staff')
  await screen.findByRole('button', { name: 'Close ticket' })
  expect(
    screen.queryByText(/within 30 minutes of the last support reply/)
  ).toBeNull()
})

it('lets support reopen a closed ticket, see the owner, and still add notes', async () => {
  detail = {
    ...detail,
    ticket: { ...detail.ticket, status: 'closed', closed_by: 'system' },
  }
  renderTicket('staff')
  expect(
    await screen.findByText(
      'This ticket closed automatically 30 minutes after the last support reply.'
    )
  ).toBeInTheDocument()
  expect(
    screen.getByText('Support can still add internal notes.')
  ).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'alice (#12)' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Reopen' })).toBeEnabled()
  expect(screen.getByRole('button', { name: 'T-ALICE-1' })).toBeEnabled()
  expect(
    screen.getByRole('textbox', { name: 'Internal note' })
  ).toBeInTheDocument()
  expect(screen.queryByRole('group', { name: 'Message type' })).toBeNull()
})

it('gives support the owner card folded on a narrow screen, and the owner none', async () => {
  renderTicket('staff')
  const card = await screen.findByRole('button', { name: /^User info/ })
  expect(card).toHaveAttribute('aria-expanded', 'false')
  expect(card).toHaveTextContent('alice')
  client.clear()
  cleanup()

  renderTicket('user')
  await screen.findByRole('list', { name: 'Conversation' })
  expect(screen.queryByRole('button', { name: /User info/ })).toBeNull()
})

it('keeps a draft when a refresh brings in a new post', async () => {
  const user = userEvent.setup()
  renderTicket('staff')
  const box = await screen.findByRole('textbox', { name: 'Reply' })
  await user.type(box, 'Half-written answer')

  detail = {
    ...detail,
    ticket: { ...detail.ticket, status: 'open' },
    messages: [
      ...detail.messages,
      {
        id: 3,
        ticket_id: 7,
        user_id: 12,
        username: 'alice',
        is_staff: false,
        kind: '',
        content: 'Any news?',
        created_at: 1_700_000_200,
        attachments: [],
      },
    ],
  }
  await client.refetchQueries({ queryKey: ticketKeys.detail('staff', 7) })

  expect(await screen.findByText('Any news?')).toBeInTheDocument()
  expect(screen.getByRole('textbox', { name: 'Reply' })).toHaveValue(
    'Half-written answer'
  )
})

it('sends the reply on Enter and empties the composer', async () => {
  const user = userEvent.setup()
  renderTicket('user')
  const box = await screen.findByRole('textbox', { name: 'Reply' })
  await user.type(box, 'Still not credited{Enter}')
  await waitFor(() =>
    expect(sent).toEqual([{ content: 'Still not credited', internal: null }])
  )
  await waitFor(() => expect(box).toHaveValue(''))
})

it('keeps the typed text when the reply is rejected', async () => {
  replyFails = true
  const user = userEvent.setup()
  renderTicket('user')
  const box = await screen.findByRole('textbox', { name: 'Reply' })
  await user.type(box, 'Please check again')
  await user.click(screen.getByRole('button', { name: 'Send reply' }))
  await waitFor(() => expect(sent).toHaveLength(1))
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

it('marks notes in the thread and sends a note once support switches to it', async () => {
  detail.messages.push({
    id: 3,
    ticket_id: 7,
    user_id: 1,
    username: 'bob',
    is_staff: true,
    kind: 'note',
    content: 'Upstream key exhausted',
    created_at: 1_700_000_200,
    attachments: [],
  })
  const user = userEvent.setup()
  renderTicket('staff')
  const thread = await screen.findByRole('list', { name: 'Conversation' })
  expect(within(thread).getByText('Internal note · bob')).toBeInTheDocument()

  await user.click(screen.getByRole('button', { name: 'Internal note' }))
  const box = screen.getByRole('textbox', { name: 'Internal note' })
  expect(box).toHaveAttribute('placeholder', 'Only support can see this note')
  await user.type(box, 'Refund requested{Enter}')
  await waitFor(() =>
    expect(sent).toEqual([{ content: 'Refund requested', internal: 'true' }])
  )
})

it('inserts a canned reply into the composer', async () => {
  const user = userEvent.setup()
  renderTicket('staff')
  const box = await screen.findByRole('textbox', { name: 'Reply' })
  await user.type(box, 'Hello,')
  await user.click(
    screen.getByRole('button', { name: 'Insert a canned reply' })
  )
  await user.click(await screen.findByRole('menuitem', { name: /Refund/ }))
  expect(box).toHaveValue('Hello,\nWe refunded your order.')
  expect(sent).toEqual([])
})

it('lets the owner rate a closed ticket once', async () => {
  detail = {
    ...detail,
    ticket: { ...detail.ticket, status: 'closed', closed_by: 'admin' },
  }
  const user = userEvent.setup()
  renderTicket('user')
  const submit = await screen.findByRole('button', { name: 'Submit rating' })
  expect(submit).toBeDisabled()
  await user.click(screen.getByRole('radio', { name: '4 of 5 stars' }))
  expect(screen.getByRole('radio', { name: '4 of 5 stars' })).toHaveAttribute(
    'aria-checked',
    'true'
  )
  await user.click(submit)
  await waitFor(() => expect(ratings).toEqual([{ rating: 4, comment: '' }]))
  expect(await screen.findByText('Your rating')).toBeInTheDocument()
  expect(screen.getByRole('img', { name: '4 of 5 stars' })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Submit rating' })).toBeNull()
})

it('offers deleting a ticket only to support allowed to delete', async () => {
  useAuthStore
    .getState()
    .auth.setUser({ id: 2, username: 'agent', role: ROLE.ADMIN })
  renderTicket('staff')
  await screen.findByRole('button', { name: 'Close ticket' })
  expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull()
  client.clear()
})

it('deletes a ticket after a destructive confirmation', async () => {
  useAuthStore
    .getState()
    .auth.setUser({ id: 1, username: 'root', role: ROLE.SUPER_ADMIN })
  const removed: string[] = []
  vi.spyOn(api, 'delete').mockImplementation(async (url) => {
    removed.push(String(url))
    return { data: { success: true, data: null } }
  })
  const user = userEvent.setup()
  renderTicket('staff')
  await user.click(await screen.findByRole('button', { name: 'Delete' }))
  expect(removed).toEqual([])
  const dialog = await screen.findByRole('alertdialog')
  await user.click(within(dialog).getByRole('button', { name: 'Delete' }))
  await waitFor(() => expect(removed).toEqual(['/api/ticket/7']))
})
