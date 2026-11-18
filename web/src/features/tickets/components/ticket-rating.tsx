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
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Star } from 'lucide-react'
import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { handleServerError } from '@/lib/handle-server-error'
import { cn } from '@/lib/utils'

import { rateTicket, ticketKeys } from '../api'
import { TICKET_RATING_COMMENT_MAX_LENGTH } from '../constants'
import type { Ticket, TicketViewer } from '../types'

const STARS = [1, 2, 3, 4, 5]

/**
 * The owner's satisfaction with a closed ticket: a form until they rate it,
 * then the stars and comment for both sides.
 */
export function TicketRating(props: { ticket: Ticket; viewer: TicketViewer }) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const commentId = useId()
  const [rating, setRating] = useState(0)
  const [comment, setComment] = useState('')
  const rate = useMutation({
    mutationFn: () => rateTicket(props.ticket.id, rating, comment),
    meta: { errorToast: false },
    onSuccess: async () => {
      toast.success(t('Thanks for your rating'))
      await queryClient.invalidateQueries({ queryKey: ticketKeys.all })
    },
    onError: (err) => handleServerError(err),
  })

  if (props.ticket.rated_at > 0) {
    return (
      <section className='space-y-2 rounded-lg border p-4'>
        <h2 className='text-sm font-medium'>
          {props.viewer === 'staff' ? t('User rating') : t('Your rating')}
        </h2>
        <div
          className='flex items-center gap-0.5'
          role='img'
          aria-label={t('{{count}} of 5 stars', { count: props.ticket.rating })}
        >
          {STARS.map((star) => (
            <Star
              key={star}
              aria-hidden='true'
              className={cn(
                'size-5',
                star <= props.ticket.rating
                  ? 'fill-warning text-warning'
                  : 'text-muted-foreground/40'
              )}
            />
          ))}
        </div>
        {props.ticket.rating_comment && (
          <p className='text-sm break-words whitespace-pre-wrap'>
            {props.ticket.rating_comment}
          </p>
        )}
      </section>
    )
  }
  if (props.viewer !== 'user' || props.ticket.status !== 'closed') {
    return null
  }
  return (
    <section className='space-y-3 rounded-lg border p-4'>
      <h2 className='text-sm font-medium'>
        {t('How satisfied are you with the support?')}
      </h2>
      <div role='radiogroup' aria-label={t('Rating')} className='flex gap-1'>
        {STARS.map((star) => (
          <button
            key={star}
            type='button'
            role='radio'
            aria-checked={rating === star}
            aria-label={t('{{count}} of 5 stars', { count: star })}
            disabled={rate.isPending}
            className='focus-visible:ring-ring rounded-sm focus-visible:ring-2 focus-visible:outline-none'
            onClick={() => setRating(star)}
          >
            <Star
              className={cn(
                'size-6',
                star <= rating
                  ? 'fill-warning text-warning'
                  : 'text-muted-foreground/50'
              )}
              aria-hidden='true'
            />
          </button>
        ))}
      </div>
      <div className='space-y-1.5'>
        <Label htmlFor={commentId}>{t('Comment (optional)')}</Label>
        <Textarea
          id={commentId}
          rows={2}
          value={comment}
          maxLength={TICKET_RATING_COMMENT_MAX_LENGTH}
          disabled={rate.isPending}
          onChange={(event) => setComment(event.target.value)}
        />
      </div>
      <Button
        size='sm'
        disabled={rating === 0 || rate.isPending}
        onClick={() => rate.mutate()}
      >
        {rate.isPending ? t('Submitting...') : t('Submit rating')}
      </Button>
    </section>
  )
}
