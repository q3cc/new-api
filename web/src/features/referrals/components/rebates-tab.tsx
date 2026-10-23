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
import type { ColumnDef } from '@tanstack/react-table'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { TimestampCell } from '@/components/activity-time-cell'
import { CopyButton } from '@/components/copy-button'
import { StatusBadge } from '@/components/status-badge'
import { Button } from '@/components/ui/button'
import { Combobox } from '@/components/ui/combobox'
import { useDebounce } from '@/hooks/use-debounce'
import { useTableUrlState, type NavigateFn } from '@/hooks/use-table-url-state'
import { toIntlLocale } from '@/i18n/languages'
import { formatNumber, formatQuota } from '@/lib/format'

import {
  approveAffiliateRebate,
  getAffiliateRebates,
  REFERRALS_QUERY_KEY,
  rejectAffiliateRebate,
  type ReferralsSearch,
} from '../api'
import { REBATE_STATUSES } from '../constants'
import { changeReferralFilters } from '../lib/referral-filters'
import type { AffiliateRebate, AffiliateRebateStatus } from '../types'
import { NoteActionDialog, type ReferralNoteAction } from './note-action-dialog'
import {
  ReferralTable,
  ReferralToolbar,
  ReferralUserCell,
} from './referral-table'

type RebatesTabProps = { search: ReferralsSearch; navigate: NavigateFn }

export function RebatesTab(props: RebatesTabProps) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const [action, setAction] = useState<ReferralNoteAction | null>(null)
  const { pagination, onPaginationChange, ensurePageInRange } =
    useTableUrlState({
      search: props.search,
      navigate: props.navigate,
      globalFilter: { enabled: false },
      pagination: { defaultPageSize: 20 },
    })
  const userId = useDebounce(props.search.user_id)
  const params = {
    status: props.search.status,
    user_id: userId,
    page: pagination.pageIndex + 1,
    pageSize: pagination.pageSize,
  }
  const query = useQuery({
    queryKey: [REFERRALS_QUERY_KEY, 'rebates', params],
    queryFn: ({ signal }) => getAffiliateRebates(params, signal),
    enabled: userId === props.search.user_id,
    meta: { errorToast: false },
  })
  const review = (rebate: AffiliateRebate, approve: boolean) =>
    setAction({
      key: `${approve ? 'approve' : 'reject'}-rebate-${rebate.id}`,
      title: approve ? t('Approve rebate') : t('Reject rebate'),
      desc: approve
        ? t("Credit this rebate to the inviter's referral rewards?")
        : t('Reject this rebate? It will not be credited.'),
      subject: (
        <p className='text-sm'>
          {formatQuota(rebate.quota)} · {rebate.inviter_username} #
          {rebate.inviter_id}
        </p>
      ),
      confirmText: approve ? t('Approve') : t('Reject'),
      destructive: !approve,
      successMessage: approve ? t('Rebate approved') : t('Rebate rejected'),
      run: (note) =>
        approve
          ? approveAffiliateRebate(rebate.id, note)
          : rejectAffiliateRebate(rebate.id, note),
    })
  const columns: ColumnDef<AffiliateRebate, unknown>[] = [
    {
      accessorKey: 'inviter_id',
      header: t('Inviter'),
      cell: ({ row }) => (
        <ReferralUserCell
          id={row.original.inviter_id}
          username={row.original.inviter_username}
        />
      ),
    },
    {
      accessorKey: 'invitee_id',
      header: t('Invitee'),
      cell: ({ row }) => (
        <ReferralUserCell
          id={row.original.invitee_id}
          username={row.original.invitee_username}
        />
      ),
    },
    {
      accessorKey: 'trade_no',
      header: t('Order Number'),
      cell: ({ row }) => (
        <div className='flex min-w-0 items-center gap-1'>
          <span className='max-w-48 truncate font-mono text-xs'>
            {row.original.trade_no}
          </span>
          <CopyButton value={row.original.trade_no} size='sm' />
        </div>
      ),
    },
    {
      accessorKey: 'source',
      header: t('Source'),
      cell: ({ row }) =>
        row.original.source === 'subscription'
          ? t('Subscription')
          : t('Top-up'),
    },
    {
      accessorKey: 'base_quota',
      header: t('Order credit'),
      cell: ({ row }) => formatQuota(row.original.base_quota),
    },
    {
      accessorKey: 'rate_bps',
      header: t('Rate'),
      cell: ({ row }) =>
        `${formatNumber(row.original.rate_bps / 100, locale)}%`,
    },
    {
      accessorKey: 'quota',
      header: t('Rebate'),
      cell: ({ row }) => formatQuota(row.original.quota),
    },
    {
      accessorKey: 'status',
      header: t('Status'),
      cell: ({ row }) => {
        const config = REBATE_STATUSES[row.original.status]
        return (
          <div className='max-w-56 space-y-0.5'>
            <StatusBadge
              label={t(config?.labelKey ?? row.original.status)}
              variant={config?.variant}
              copyable={false}
            />
            {row.original.reason && (
              <div className='text-muted-foreground text-xs'>
                {t(row.original.reason)}
                {row.original.risk_score > 0 &&
                  ` · ${t('Risk score {{score}}', { score: row.original.risk_score })}`}
              </div>
            )}
            {row.original.review_note && (
              <div className='text-muted-foreground truncate text-xs'>
                {row.original.review_note}
              </div>
            )}
          </div>
        )
      },
    },
    {
      id: 'confirm_time',
      header: t('Confirmation time'),
      cell: ({ row }) => (
        <TimestampCell
          timestamp={row.original.confirmed_at || row.original.confirm_at}
          format='absolute'
          justNowLabel={t('Just now')}
        />
      ),
    },
    {
      id: 'actions',
      header: t('Actions'),
      cell: ({ row }) => {
        const status = row.original.status
        if (status !== 'pending' && status !== 'review') return null
        return (
          <div className='flex gap-1'>
            {status === 'review' && (
              <Button
                size='sm'
                variant='outline'
                onClick={() => review(row.original, true)}
              >
                {t('Approve')}
              </Button>
            )}
            <Button
              size='sm'
              variant='ghost'
              onClick={() => review(row.original, false)}
            >
              {t('Reject')}
            </Button>
          </div>
        )
      },
    },
  ]
  const statusLabel = t('Status')
  const toolbar = (
    <ReferralToolbar
      search={props.search}
      navigate={props.navigate}
      pageSize={pagination.pageSize}
      refreshing={query.isFetching}
      onRefresh={() => void query.refetch()}
    >
      <Combobox
        aria-label={statusLabel}
        className='w-full sm:w-40'
        options={[
          { value: '', label: statusLabel },
          ...(Object.keys(REBATE_STATUSES) as AffiliateRebateStatus[]).map(
            (value) => ({
              value,
              label: t(REBATE_STATUSES[value].labelKey),
            })
          ),
        ]}
        value={props.search.status ?? ''}
        onValueChange={(value) =>
          changeReferralFilters(props.navigate, {
            status: (value || undefined) as AffiliateRebateStatus | undefined,
          })
        }
      />
    </ReferralToolbar>
  )
  return (
    <>
      <ReferralTable
        query={query}
        columns={columns}
        toolbar={toolbar}
        emptyTitle={t('No rebates found')}
        getRowId={(row) => String(row.id)}
        pagination={pagination}
        onPaginationChange={onPaginationChange}
        ensurePageInRange={ensurePageInRange}
      />
      <NoteActionDialog action={action} onClose={() => setAction(null)} />
    </>
  )
}
