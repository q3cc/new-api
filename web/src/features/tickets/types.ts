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

export type TicketStatus = 'open' | 'replied' | 'closed'

export type TicketCategory = 'billing' | 'api' | 'account' | 'other'

export type TicketPriority = 'urgent' | 'high' | 'normal' | 'low'

export type Ticket = {
  id: number
  user_id: number
  title: string
  category: TicketCategory
  status: TicketStatus
  /** Empty for the ticket's owner, who does not see priorities. */
  priority: TicketPriority | ''
  topup_trade_no: string
  request_id: string
  assignee_id: number
  user_unread: boolean
  admin_unread: boolean
  created_at: number
  updated_at: number
  /** When the ticket last started waiting for support. */
  waiting_since: number
  first_replied_at: number
  closed_at: number
  closed_by: '' | 'user' | 'admin' | 'system'
  /** 1 to 5 stars once the owner rated the closed ticket, else 0. */
  rating: number
  rating_comment: string
  rated_at: number
  username?: string
  /** When an open ticket's response target runs out; support views only. */
  response_due_at?: number
}

export type TicketCannedReply = {
  id: number
  title: string
  content: string
  updated_at: number
}

/** Response targets in hours, per priority. */
export type TicketSettings = {
  sla_urgent_hours: number
  sla_high_hours: number
  sla_normal_hours: number
  sla_low_hours: number
}

export type TicketAttachment = {
  id: number
  media_type: string
  size: number
}

export type TicketMessage = {
  id: number
  ticket_id: number
  user_id: number
  is_staff: boolean
  /** 'note' for a post only support sees; empty for a reply. */
  kind: '' | 'note'
  content: string
  created_at: number
  username?: string
  attachments: TicketAttachment[]
}

export type TicketDetail = {
  ticket: Ticket
  messages: TicketMessage[]
}

export type TicketPage = {
  items: Ticket[]
  total: number
}

export type TicketSummary = {
  open: number
  overdue: number
  replied: number
  unread: number
}

export type TicketDraft = {
  title: string
  category: TicketCategory
  content: string
  topup_trade_no: string
  request_id: string
  images: File[]
}

export type TicketReply = {
  content: string
  images: File[]
  /** Posts a support message as a note only support sees. */
  internal?: boolean
}

/** Which side of a ticket the console is acting for */
export type TicketViewer = 'user' | 'staff'
