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
import { getRouteApi } from '@tanstack/react-router'

import { TicketDetailView } from './components/ticket-detail-view'
import { TicketQueuePage } from './ticket-queue'
import { UserTicketsPage } from './user-tickets'

const userListRoute = getRouteApi('/_authenticated/tickets/')
const userDetailRoute = getRouteApi('/_authenticated/tickets/$ticketId')
const queueRoute = getRouteApi('/_authenticated/tickets/manage/')
const staffDetailRoute = getRouteApi('/_authenticated/tickets/manage/$ticketId')

export function UserTickets() {
  return (
    <UserTicketsPage
      search={userListRoute.useSearch()}
      navigate={userListRoute.useNavigate()}
    />
  )
}

export function UserTicketDetail() {
  const params = userDetailRoute.useParams()
  return <TicketDetailView viewer='user' ticketId={Number(params.ticketId)} />
}

export function TicketQueue() {
  return (
    <TicketQueuePage
      search={queueRoute.useSearch()}
      navigate={queueRoute.useNavigate()}
    />
  )
}

export function StaffTicketDetail() {
  const params = staffDetailRoute.useParams()
  return <TicketDetailView viewer='staff' ticketId={Number(params.ticketId)} />
}
