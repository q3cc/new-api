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
import { useQuery } from '@tanstack/react-query'
import { Trophy } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import {
  StaticDataTable,
  type StaticDataTableColumn,
} from '@/components/data-table'
import { ErrorState } from '@/components/error-state'
import { Card, CardContent } from '@/components/ui/card'
import { IconBadge } from '@/components/ui/icon-badge'
import { Skeleton } from '@/components/ui/skeleton'
import { toIntlLocale } from '@/i18n/languages'
import { formatNumber, formatQuota } from '@/lib/format'
import { cn } from '@/lib/utils'

import { getAffiliateLeaderboard, promotionQueryKeys } from '../api'
import type { LeaderboardRow } from '../types'

/** Text colors of the top three ranks, as on a podium. */
const PODIUM_CLASSES: Record<number, string> = {
  1: 'text-destructive',
  2: 'text-warning',
  3: 'text-info',
}

/**
 * Inviters ranked by the rebates credited to them this quarter, with the
 * caller's own standing above the table.
 */
export function PromotionLeaderboard() {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const { data, isPending, isError, refetch } = useQuery({
    queryKey: promotionQueryKeys.leaderboard,
    queryFn: ({ signal }) => getAffiliateLeaderboard(signal),
  })

  if (isError) {
    return <ErrorState onRetry={() => void refetch()} />
  }

  const me = data?.me
  const standing = [
    {
      label: t('My rank'),
      value: me && me.rank > 0 ? String(me.rank) : t('Not ranked'),
    },
    { label: t('This quarter'), value: formatQuota(me?.quarter_quota ?? 0) },
    {
      label: t("This month's earnings"),
      value: formatQuota(me?.month_quota ?? 0),
    },
    { label: t('Total earnings'), value: formatQuota(me?.total_quota ?? 0) },
  ]

  const columns: StaticDataTableColumn<LeaderboardRow>[] = [
    {
      id: 'rank',
      header: t('Rank'),
      className: 'w-16',
      cell: (row) => (
        <span className='font-semibold tabular-nums'>{row.rank}</span>
      ),
    },
    {
      id: 'user',
      header: t('User'),
      cell: (row) => (
        <span className='inline-flex items-center gap-1.5 break-all'>
          {row.rank <= 3 ? (
            <Trophy className='size-4 shrink-0' aria-hidden='true' />
          ) : null}
          <span className='font-mono'>{row.name}</span>
          {row.is_me ? (
            <span className='bg-primary text-primary-foreground rounded px-1.5 py-0.5 text-xs font-medium'>
              {t('You')}
            </span>
          ) : null}
        </span>
      ),
    },
    {
      id: 'total',
      header: t('Total earnings'),
      cell: (row) => (
        <span className='tabular-nums'>{formatQuota(row.total_quota)}</span>
      ),
    },
    {
      id: 'month',
      header: t("This month's earnings"),
      cell: (row) => (
        <span className='tabular-nums'>{formatQuota(row.month_quota)}</span>
      ),
    },
    {
      id: 'paying',
      header: t('Paying invitees'),
      cell: (row) => (
        <span className='tabular-nums'>
          {formatNumber(row.paying_invites, locale)}
        </span>
      ),
    },
    {
      id: 'quarter',
      header: t('This quarter'),
      cell: (row) => (
        <span className='font-semibold tabular-nums'>
          {formatQuota(row.quarter_quota)}
        </span>
      ),
    },
  ]

  return (
    <Card data-card-hover='false' className='py-0'>
      <CardContent className='grid gap-4 p-3 sm:p-4'>
        <div className='flex items-center gap-2.5'>
          <IconBadge tone='chart-3'>
            <Trophy />
          </IconBadge>
          <div className='min-w-0'>
            <h2 className='text-sm font-semibold'>
              {t('Referral leaderboard')}
            </h2>
            <p className='text-muted-foreground text-xs'>
              {t(
                'Ranked by referral rebates credited this quarter, updated every minute.'
              )}
            </p>
          </div>
        </div>
        <dl className='grid grid-cols-2 gap-2 sm:grid-cols-4'>
          {standing.map((item) => (
            <div key={item.label} className='bg-muted/40 rounded-lg px-3 py-2'>
              <dt className='text-muted-foreground text-xs'>{item.label}</dt>
              <dd className='mt-0.5 truncate text-base font-semibold tabular-nums'>
                {isPending ? <Skeleton className='h-6 w-16' /> : item.value}
              </dd>
            </div>
          ))}
        </dl>
        {isPending ? (
          <Skeleton className='h-48 rounded-lg' />
        ) : (
          <StaticDataTable
            columns={columns}
            data={data.rows}
            getRowKey={(row) => row.rank}
            getRowClassName={(row) =>
              cn(PODIUM_CLASSES[row.rank], row.is_me && 'bg-primary/5')
            }
            getRowProps={(row) => (row.is_me ? { 'aria-current': true } : {})}
            emptyContent={t('No one is ranked yet')}
          />
        )}
      </CardContent>
    </Card>
  )
}
