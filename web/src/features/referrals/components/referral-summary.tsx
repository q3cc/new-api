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
import { useTranslation } from 'react-i18next'

import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { toIntlLocale } from '@/i18n/languages'
import { formatNumber, formatQuota } from '@/lib/format'

import { getReferralSummary, REFERRALS_QUERY_KEY } from '../api'

/** Headline counts of the referral program. */
export function ReferralSummary() {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const query = useQuery({
    queryKey: [REFERRALS_QUERY_KEY, 'summary'],
    queryFn: ({ signal }) => getReferralSummary(signal),
    meta: { errorToast: false },
  })
  const summary = query.data
  const stats = [
    {
      label: t('Active invitations'),
      value: summary && formatNumber(summary.active_invites, locale),
    },
    {
      label: t('Cancellations'),
      value: summary && formatNumber(summary.cancelled_invites, locale),
    },
    {
      label: t('Unconfirmed rebates'),
      value: summary && formatQuota(summary.pending_quota),
    },
    {
      label: t('Awaiting review'),
      value: summary && formatNumber(summary.review_count, locale),
    },
  ]
  return (
    <Card data-card-hover='false' className='bg-muted/20 py-0'>
      <CardContent className='grid grid-cols-2 gap-3 p-3 sm:grid-cols-4 sm:p-4'>
        {stats.map((stat) => (
          <div key={stat.label} className='min-w-0'>
            <div className='text-muted-foreground truncate text-xs font-medium'>
              {stat.label}
            </div>
            <div className='mt-1 truncate text-lg font-semibold tabular-nums'>
              {query.isPending ? (
                <Skeleton className='h-6 w-16' />
              ) : (
                (stat.value ?? '—')
              )}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}
