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

import {
  StaticDataTable,
  type StaticDataTableColumn,
} from '@/components/data-table'
import { toIntlLocale } from '@/i18n/languages'
import { cn } from '@/lib/utils'

import { formatLeaderboardScore } from '../lib/leaderboard'
import type { LeaderboardRow, LotteryActivityView } from '../types'

type ActivityLeaderboardProps = {
  activity: LotteryActivityView
}

/** The viewer's standing and the public ranks of a leaderboard activity. */
export function ActivityLeaderboard(props: ActivityLeaderboardProps) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const board = props.activity.leaderboard
  if (!board) return null
  const metric = props.activity.rank_metric
  const score = (value: number) => formatLeaderboardScore(metric, value, locale)
  const me = board.me

  let standing: string
  if (me.rank > 0) {
    standing = t('Rank {{rank}}', { rank: me.rank })
  } else if (me.excluded) {
    standing = t('Administrators and disabled accounts are not ranked')
  } else {
    standing = t('Not ranked')
  }
  let hint: string | null = null
  const gap = props.activity.rank_min_value - me.score
  if (me.rank === 0 && !me.excluded && !board.final) {
    hint =
      gap > 0
        ? t('{{gap}} more to be ranked', { gap: score(gap) })
        : t('Not in the listed ranks yet')
  }

  const columns: StaticDataTableColumn<LeaderboardRow>[] = [
    {
      id: 'rank',
      header: t('Rank'),
      cell: (row) => <span className='tabular-nums'>{row.rank}</span>,
    },
    {
      id: 'user',
      header: t('User'),
      cell: (row) => {
        const isMe = row.rank === me.rank
        return (
          <span className={cn('break-all', isMe && 'text-primary font-medium')}>
            {row.display_name || `#${row.user_id}`}
            {isMe ? (
              <span className='bg-primary text-primary-foreground ms-1.5 rounded px-1.5 py-0.5 text-xs font-medium'>
                {t('You')}
              </span>
            ) : null}
          </span>
        )
      },
    },
    {
      id: 'score',
      header: t('Score'),
      cell: (row) => <span className='tabular-nums'>{score(row.score)}</span>,
    },
  ]

  return (
    <div className='flex w-full flex-col gap-3'>
      <div className='text-center'>
        <div className='text-muted-foreground text-xs'>{t('My standing')}</div>
        <div
          className={cn(
            'font-semibold',
            me.rank > 0 ? 'text-primary text-2xl tabular-nums' : 'text-base'
          )}
        >
          {standing}
        </div>
        {!me.excluded ? (
          <div className='text-muted-foreground text-xs tabular-nums'>
            {t('Score: {{score}}', { score: score(me.score) })}
          </div>
        ) : null}
        {hint ? <div className='text-warning text-xs'>{hint}</div> : null}
      </div>
      <StaticDataTable
        columns={columns}
        data={board.rows}
        getRowKey={(row) => row.rank}
        getRowClassName={(row) =>
          row.rank === me.rank ? 'bg-primary/5' : undefined
        }
        getRowProps={(row) =>
          row.rank === me.rank ? { 'aria-current': true } : {}
        }
        emptyContent={t('No one is ranked yet')}
      />
      <p className='text-muted-foreground text-center text-xs'>
        {board.final
          ? t('Final ranks of {{count}} users', { count: board.ranked })
          : t('{{count}} users ranked, updated every minute', {
              count: board.ranked,
            })}
      </p>
    </div>
  )
}
