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
import { Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'

import type { Ticket, TicketViewer } from '../types'

/**
 * A ticket's number and title linking to its conversation, with a dot when
 * the other side posted something this viewer has not opened.
 */
export function TicketTitleLink(props: {
  ticket: Ticket
  viewer: TicketViewer
}) {
  const { t } = useTranslation()
  const unread =
    props.viewer === 'staff'
      ? props.ticket.admin_unread
      : props.ticket.user_unread
  const params = { ticketId: String(props.ticket.id) }
  const className =
    'flex max-w-96 min-w-0 items-center gap-2 font-medium underline-offset-4 hover:underline'
  const content = (
    <>
      {unread && (
        <span
          className='bg-destructive size-2 shrink-0 rounded-full'
          role='img'
          aria-label={t('Unread reply')}
        />
      )}
      <span className='text-muted-foreground shrink-0'>#{props.ticket.id}</span>
      <span className='truncate'>{props.ticket.title}</span>
    </>
  )
  return props.viewer === 'staff' ? (
    <Link to='/tickets/manage/$ticketId' params={params} className={className}>
      {content}
    </Link>
  ) : (
    <Link to='/tickets/$ticketId' params={params} className={className}>
      {content}
    </Link>
  )
}
