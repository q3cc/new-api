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
import { Trophy } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { formatTimestamp } from '@/lib/format'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth-store'

import type { LotteryWinner } from '../types'

type ActivityWinnersProps = {
  winners: LotteryWinner[]
  total: number
}

/** The public winner list of an activity, naming winners by user ID. */
export function ActivityWinners(props: ActivityWinnersProps) {
  const { t } = useTranslation()
  const currentUserId = useAuthStore((state) => state.auth.user?.id)
  if (props.total === 0) return null

  return (
    <section className='grid gap-2' aria-label={t('Winners list')}>
      <div className='flex items-center gap-2 font-medium'>
        <Trophy className='text-warning size-4' aria-hidden='true' />
        {props.total > props.winners.length
          ? t('Winners ({{count}}, latest {{shown}} shown)', {
              count: props.total,
              shown: props.winners.length,
            })
          : t('Winners ({{count}})', { count: props.total })}
      </div>
      <ul className='grid max-h-48 gap-1 overflow-y-auto rounded-md border p-2'>
        {props.winners.map((winner, index) => {
          const isMe = winner.user_id === currentUserId
          return (
            <li
              // A user can win several times, so the position keeps keys unique.
              // eslint-disable-next-line react/no-array-index-key
              key={`${winner.user_id}-${winner.created_at}-${index}`}
              className={cn(
                'grid grid-cols-[5.5rem_minmax(0,1fr)_auto] items-center gap-3 rounded px-2 py-1',
                isMe && 'bg-primary/10'
              )}
            >
              <span className='font-medium tabular-nums'>
                #{winner.user_id}
                {isMe ? (
                  <span className='text-primary ml-1 text-xs'>{t('Me')}</span>
                ) : null}
              </span>
              <span className='truncate'>{winner.prize_name}</span>
              <span className='text-muted-foreground text-xs tabular-nums'>
                {formatTimestamp(winner.created_at)}
              </span>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
