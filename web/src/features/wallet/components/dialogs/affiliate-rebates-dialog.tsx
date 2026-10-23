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
import { Dialog } from '@/components/dialog'
import { StatusBadge } from '@/components/status-badge'
import { Button } from '@/components/ui/button'
import { toIntlLocale } from '@/i18n/languages'
import { formatNumber, formatQuota } from '@/lib/format'

import {
  AFFILIATE_REBATE_STATUSES,
  AFFILIATE_REBATES_PAGE_SIZE,
} from '../../constants'
import { useAffiliateRebates } from '../../hooks/use-affiliate'
import type { AffiliateRebate } from '../../types'

type AffiliateRebatesDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function AffiliateRebatesDialog(props: AffiliateRebatesDialogProps) {
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
        <span className='tabular-nums'>#{rebate.invitee_id}</span>
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
      cell: (rebate) => (
        <TimestampCell
          timestamp={
            rebate.status === 'confirmed'
              ? rebate.confirmed_at
              : rebate.confirm_at
          }
          format='absolute'
          justNowLabel={t('Just now')}
        />
      ),
    },
  ]

  return (
    <Dialog
      open={props.open}
      onOpenChange={(open) => {
        if (!open) setPage(1)
        props.onOpenChange(open)
      }}
      title={t('Rebate details')}
      description={t(
        'Rebates from payments of users you invited. Each one is credited to your referral rewards after its confirmation period.'
      )}
      contentClassName='sm:max-w-3xl'
    >
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
        {pageCount > 1 ? (
          <div className='flex items-center justify-end gap-2 text-sm'>
            <Button
              size='sm'
              variant='outline'
              onClick={() => setPage((current) => current - 1)}
              disabled={page <= 1}
            >
              {t('Previous page')}
            </Button>
            <span className='text-muted-foreground tabular-nums'>
              {page} / {pageCount}
            </span>
            <Button
              size='sm'
              variant='outline'
              onClick={() => setPage((current) => current + 1)}
              disabled={page >= pageCount}
            >
              {t('Next page')}
            </Button>
          </div>
        ) : null}
      </div>
    </Dialog>
  )
}
