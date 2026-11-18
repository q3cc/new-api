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
import z from 'zod'

import { api } from '@/lib/api'
import { requireServerSuccess } from '@/lib/server-error-message'

import { TICKET_CATEGORIES, TICKET_STATUSES } from './constants'
import type {
  Ticket,
  TicketDetail,
  TicketDraft,
  TicketPage,
  TicketReply,
  TicketSummary,
  TicketViewer,
} from './types'

type Envelope<T> = { success: boolean; message?: string; data: T }

const pageFields = {
  page: z.number().int().min(1).optional().catch(1),
  pageSize: z.number().int().min(1).max(100).optional().catch(20),
  status: z.enum(TICKET_STATUSES).optional().catch(undefined),
}

export const userTicketsSearchSchema = z.object(pageFields)
export type UserTicketsSearch = z.infer<typeof userTicketsSearchSchema>

export const ticketQueueSearchSchema = z.object({
  ...pageFields,
  category: z.enum(TICKET_CATEGORIES).optional().catch(undefined),
  keyword: z.string().max(128).optional().catch(''),
  user_id: z.number().int().min(1).optional().catch(undefined),
  mine: z.boolean().optional().catch(undefined),
})
export type TicketQueueSearch = z.infer<typeof ticketQueueSearchSchema>

/** Query keys; invalidating the root refreshes every ticket view and badge. */
export const ticketKeys = {
  all: ['tickets'] as const,
  userList: (search: UserTicketsSearch) =>
    ['tickets', 'user', 'list', search] as const,
  userUnread: ['tickets', 'user', 'unread'] as const,
  queue: (search: TicketQueueSearch) =>
    ['tickets', 'staff', 'list', search] as const,
  summary: ['tickets', 'staff', 'summary'] as const,
  detail: (viewer: TicketViewer, id: number) =>
    ['tickets', viewer, 'detail', id] as const,
  attachment: (id: number) => ['tickets', 'attachment', id] as const,
}

function toFormData(fields: Record<string, string>, images: File[]) {
  const form = new FormData()
  for (const [name, value] of Object.entries(fields)) {
    form.append(name, value)
  }
  for (const image of images) {
    form.append('images', image)
  }
  return form
}

export async function getUserTickets(
  search: UserTicketsSearch,
  signal?: AbortSignal
) {
  const response = await api.get<
    Envelope<{ unread: number; page: TicketPage }>
  >('/api/user/tickets', {
    params: {
      status: search.status,
      p: search.page ?? 1,
      page_size: search.pageSize ?? 20,
    },
    signal,
  })
  return requireServerSuccess(response.data).data
}

export async function getUserTicketUnread(signal?: AbortSignal) {
  const response = await api.get<Envelope<{ unread: number }>>(
    '/api/user/tickets/unread',
    { signal }
  )
  return requireServerSuccess(response.data).data.unread
}

export async function createTicket(draft: TicketDraft) {
  const form = toFormData(
    {
      title: draft.title,
      category: draft.category,
      content: draft.content,
      topup_trade_no: draft.topup_trade_no,
      request_id: draft.request_id,
    },
    draft.images
  )
  const response = await api.post<Envelope<Ticket>>('/api/user/tickets', form)
  return requireServerSuccess(response.data).data
}

export async function getTicketQueue(
  search: TicketQueueSearch,
  signal?: AbortSignal
) {
  const response = await api.get<Envelope<TicketPage>>('/api/ticket/', {
    params: {
      status: search.status,
      category: search.category,
      keyword: search.keyword || undefined,
      user_id: search.user_id,
      mine: search.mine ? 'true' : undefined,
      p: search.page ?? 1,
      page_size: search.pageSize ?? 20,
    },
    signal,
  })
  return requireServerSuccess(response.data).data
}

export async function getTicketSummary(signal?: AbortSignal) {
  const response = await api.get<Envelope<TicketSummary>>(
    '/api/ticket/summary',
    { signal }
  )
  return requireServerSuccess(response.data).data
}

/** Paths of one ticket for the side the console acts for. */
function ticketPath(viewer: TicketViewer, id: number) {
  return viewer === 'staff' ? `/api/ticket/${id}` : `/api/user/tickets/${id}`
}

export async function getTicketDetail(
  viewer: TicketViewer,
  id: number,
  signal?: AbortSignal
) {
  const response = await api.get<Envelope<TicketDetail>>(
    ticketPath(viewer, id),
    { signal }
  )
  return requireServerSuccess(response.data).data
}

export async function replyTicket(
  viewer: TicketViewer,
  id: number,
  reply: TicketReply
) {
  const response = await api.post<Envelope<Ticket>>(
    `${ticketPath(viewer, id)}/reply`,
    toFormData({ content: reply.content }, reply.images)
  )
  return requireServerSuccess(response.data).data
}

export async function closeTicket(viewer: TicketViewer, id: number) {
  const response = await api.post<Envelope<null>>(
    `${ticketPath(viewer, id)}/close`
  )
  return requireServerSuccess(response.data)
}

export async function reopenTicket(id: number) {
  const response = await api.post<Envelope<null>>(`/api/ticket/${id}/reopen`)
  return requireServerSuccess(response.data)
}

export async function getTicketAttachment(id: number, signal?: AbortSignal) {
  // An img request cannot carry the dashboard Bearer token, so the image is
  // fetched through the shared client and shown from a blob URL.
  const response = await api.get<Blob>(`/api/ticket/attachment/${id}`, {
    responseType: 'blob',
    signal,
    disableDuplicate: true,
    skipErrorHandler: true,
    skipBusinessError: true,
  })
  return response.data.type.startsWith('image/') ? response.data : null
}
