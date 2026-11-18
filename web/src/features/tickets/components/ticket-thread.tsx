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
import { useTranslation } from 'react-i18next'

import { formatTimestampToDate } from '@/lib/format'
import { cn } from '@/lib/utils'

import type { TicketMessage, TicketViewer } from '../types'
import { TicketImage } from './ticket-image'

/**
 * The posts of a ticket, oldest first. Text is shown as written, never as
 * HTML or Markdown, so a post cannot restyle the console or load remote
 * content in a reader's browser.
 */
export function TicketThread(props: {
  viewer: TicketViewer
  messages: TicketMessage[]
}) {
  const { t } = useTranslation()

  return (
    <ol className='space-y-3' aria-label={t('Conversation')}>
      {props.messages.map((message) => {
        let author = t('You')
        if (message.is_staff) {
          author =
            props.viewer === 'staff' && message.username
              ? t('Support · {{name}}', { name: message.username })
              : t('Support')
        } else if (props.viewer === 'staff') {
          author = message.username || t('User')
        }
        return (
          <li
            key={message.id}
            className={cn(
              'rounded-lg border p-4',
              message.is_staff && 'bg-muted/50'
            )}
          >
            <div className='mb-2 flex flex-wrap items-baseline justify-between gap-2'>
              <span className='text-sm font-medium'>{author}</span>
              <time className='text-muted-foreground text-xs'>
                {formatTimestampToDate(message.created_at)}
              </time>
            </div>
            <p className='text-sm break-words whitespace-pre-wrap'>
              {message.content}
            </p>
            {message.attachments.length > 0 && (
              <div className='mt-3 flex flex-wrap gap-2'>
                {message.attachments.map((attachment) => (
                  <TicketImage key={attachment.id} id={attachment.id} />
                ))}
              </div>
            )}
          </li>
        )
      })}
    </ol>
  )
}
