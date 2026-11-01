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
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { TimestampCell } from '@/components/activity-time-cell'
import {
  StaticDataTable,
  type StaticDataTableColumn,
} from '@/components/data-table'
import { PagePager } from '@/components/page-pager'
import { StatusBadge } from '@/components/status-badge'
import { formatQuota } from '@/lib/format'

import {
  getAffiliateInvitees,
  INVITEES_PAGE_SIZE,
  promotionQueryKeys,
} from '../api'
import type { AffiliateInvitee } from '../types'

/** Every user the caller invited, cancelled invitations included. */
export function PromotionInvitees() {
  const { t } = useTranslation()
  const [page, setPage] = useState(1)
  const { data, isPending } = useQuery({
    queryKey: promotionQueryKeys.invitees(page),
    queryFn: ({ signal }) => getAffiliateInvitees(page, signal),
    placeholderData: keepPreviousData,
  })
  const total = data?.total ?? 0
  const pageCount = Math.max(Math.ceil(total / INVITEES_PAGE_SIZE), 1)

  const columns: StaticDataTableColumn<AffiliateInvitee>[] = [
    {
      id: 'user',
      header: t('Invitee'),
      cell: (invitee) => (
        <span className='font-mono break-all'>{invitee.name}</span>
      ),
    },
    {
      id: 'status',
      header: t('Status'),
      cell: (invitee) => {
        if (!invitee.cancelled) {
          return (
            <StatusBadge
              label={t('Invitation active')}
              variant='success'
              copyable={false}
            />
          )
        }
        return (
          <div className='grid justify-items-start gap-0.5'>
            <StatusBadge
              label={t('Cancelled')}
              variant='danger'
              copyable={false}
            />
            {invitee.cancel_reason ? (
              <span className='text-muted-foreground text-xs'>
                {t(invitee.cancel_reason)}
              </span>
            ) : null}
          </div>
        )
      },
    },
    {
      id: 'joined',
      header: t('Registered at'),
      cell: (invitee) => (
        <TimestampCell
          timestamp={invitee.created_at}
          format='absolute'
          justNowLabel={t('Just now')}
        />
      ),
    },
    {
      id: 'credited',
      header: t('Credited'),
      cell: (invitee) => (
        <span className='tabular-nums'>
          {formatQuota(invitee.confirmed_quota)}
        </span>
      ),
    },
    {
      id: 'pending',
      header: t('Confirming'),
      cell: (invitee) => (
        <span className='text-muted-foreground tabular-nums'>
          {formatQuota(invitee.pending_quota)}
        </span>
      ),
    },
  ]

  return (
    <div className='grid gap-3'>
      {isPending ? (
        <p className='text-muted-foreground text-sm'>{t('Loading...')}</p>
      ) : (
        <StaticDataTable
          columns={columns}
          data={data?.items ?? []}
          getRowKey={(invitee) => invitee.invitee_id}
          getRowClassName={(invitee) =>
            invitee.cancelled ? 'text-muted-foreground' : undefined
          }
          emptyContent={t('You have not invited anyone yet')}
        />
      )}
      <PagePager page={page} pageCount={pageCount} onPageChange={setPage} />
    </div>
  )
}
