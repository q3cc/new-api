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

export type Ticket = {
  id: number
  user_id: number
  title: string
  category: TicketCategory
  status: TicketStatus
  topup_trade_no: string
  request_id: string
  assignee_id: number
  user_unread: boolean
  admin_unread: boolean
  created_at: number
  updated_at: number
  closed_at: number
  closed_by: '' | 'user' | 'admin' | 'system'
  username?: string
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
}

/** Which side of a ticket the console is acting for */
export type TicketViewer = 'user' | 'staff'
