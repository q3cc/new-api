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
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { TimestampCell } from '@/components/activity-time-cell'
import {
  StaticDataTable,
  type StaticDataTableColumn,
} from '@/components/data-table'
import { PagePager } from '@/components/page-pager'
import { StatusBadge } from '@/components/status-badge'
import { toIntlLocale } from '@/i18n/languages'
import { formatNumber, formatQuota } from '@/lib/format'

import {
  AFFILIATE_REBATE_STATUSES,
  AFFILIATE_REBATES_PAGE_SIZE,
} from '../constants'
import { useAffiliateRebates } from '../hooks/use-affiliate'
import type { AffiliateRebate } from '../types'

/**
 * The caller's referral rebates, one per paid order of an invited user, with
 * the status of each and its paging.
 */
export function AffiliateRebatesTable() {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const [page, setPage] = useState(1)
  const { data, isPending } = useAffiliateRebates(page)

  const rebates = data?.page.items ?? []
  const total = data?.page.total ?? 0
  const pageCount = Math.max(Math.ceil(total / AFFILIATE_REBATES_PAGE_SIZE), 1)

  const columns: StaticDataTableColumn<AffiliateRebate>[] = [
    {
      id: 'invitee',
      header: t('Invitee'),
      cell: (rebate) => (
        <span className='font-mono break-all'>
          {rebate.invitee_name || `#${rebate.invitee_id}`}
        </span>
      ),
    },
    {
      id: 'source',
      header: t('Source'),
      cell: (rebate) =>
        rebate.source === 'subscription' ? t('Subscription') : t('Top-up'),
    },
    {
      id: 'base',
      header: t('Order credit'),
      cell: (rebate) => formatQuota(rebate.base_quota),
    },
    {
      id: 'rebate',
      header: t('Rebate'),
      cell: (rebate) => (
        <div className='grid gap-0.5'>
          <span className='font-medium'>{formatQuota(rebate.quota)}</span>
          <span className='text-muted-foreground text-xs'>
            {formatNumber(rebate.rate_bps / 100, locale)}%
          </span>
        </div>
      ),
    },
    {
      id: 'status',
      header: t('Status'),
      cell: (rebate) => {
        const status = AFFILIATE_REBATE_STATUSES[rebate.status]
        return (
          <div className='grid justify-items-start gap-0.5'>
            <StatusBadge
              label={t(status.labelKey)}
              variant={status.variant}
              copyable={false}
            />
            {rebate.reason ? (
              <span className='text-muted-foreground text-xs'>
                {t(rebate.reason)}
              </span>
            ) : null}
          </div>
        )
      },
    },
    {
      id: 'confirm',
      header: t('Confirmation time'),
      cell: (rebate) => {
        // A rebate under review or rejected has no date it will credit on.
        let timestamp = 0
        if (rebate.status === 'confirmed') timestamp = rebate.confirmed_at
        if (rebate.status === 'pending') timestamp = rebate.confirm_at
        return (
          <TimestampCell
            timestamp={timestamp}
            format='absolute'
            justNowLabel={t('Just now')}
          />
        )
      },
    },
  ]

  return (
    <div className='grid gap-3'>
      {isPending ? (
        <p className='text-muted-foreground text-sm'>{t('Loading...')}</p>
      ) : (
        <StaticDataTable
          columns={columns}
          data={rebates}
          getRowKey={(rebate) => rebate.id}
          emptyContent={t('No rebates yet')}
        />
      )}
      <PagePager page={page} pageCount={pageCount} onPageChange={setPage} />
    </div>
  )
}
