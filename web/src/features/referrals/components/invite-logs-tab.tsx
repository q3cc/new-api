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
import { StatusBadge } from '@/components/status-badge'
import { Button } from '@/components/ui/button'
import { Combobox } from '@/components/ui/combobox'
import { useDebounce } from '@/hooks/use-debounce'
import { useTableUrlState, type NavigateFn } from '@/hooks/use-table-url-state'

import {
  getAffiliateInviteLogs,
  REFERRALS_QUERY_KEY,
  restoreAffiliateInvite,
  type ReferralsSearch,
} from '../api'
import { INVITE_LOG_ACTIONS } from '../constants'
import { changeReferralFilters } from '../lib/referral-filters'
import type { AffiliateInviteAction, AffiliateInviteLog } from '../types'
import { NoteActionDialog, type ReferralNoteAction } from './note-action-dialog'
import {
  ReferralTable,
  ReferralToolbar,
  ReferralUserCell,
} from './referral-table'

type InviteLogsTabProps = { search: ReferralsSearch; navigate: NavigateFn }

export function InviteLogsTab(props: InviteLogsTabProps) {
  const { t } = useTranslation()
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
    action: props.search.action,
    user_id: userId,
    page: pagination.pageIndex + 1,
    pageSize: pagination.pageSize,
  }
  const query = useQuery({
    queryKey: [REFERRALS_QUERY_KEY, 'logs', params],
    queryFn: ({ signal }) => getAffiliateInviteLogs(params, signal),
    enabled: userId === props.search.user_id,
    meta: { errorToast: false },
  })
  const restore = (log: AffiliateInviteLog) =>
    setAction({
      key: `restore-invite-${log.id}`,
      title: t('Restore invitation'),
      desc: t(
        'The invitee will count as invited by the inviter again, and the shared-IP check will skip this pair. Rejected rebates stay rejected.'
      ),
      subject: (
        <p className='text-sm'>
          {log.invitee_username} #{log.invitee_id} ← {log.inviter_username} #
          {log.inviter_id}
        </p>
      ),
      confirmText: t('Restore'),
      successMessage: t('Invitation restored'),
      run: (note) => restoreAffiliateInvite(log.id, note),
    })
  const columns: ColumnDef<AffiliateInviteLog, unknown>[] = [
    {
      accessorKey: 'created_at',
      header: t('Time'),
      cell: ({ row }) => (
        <TimestampCell
          timestamp={row.original.created_at}
          format='absolute'
          justNowLabel={t('Just now')}
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
      accessorKey: 'action',
      header: t('Action'),
      cell: ({ row }) => {
        const config = INVITE_LOG_ACTIONS[row.original.action]
        return (
          <StatusBadge
            label={t(config?.labelKey ?? row.original.action)}
            variant={config?.variant}
            copyable={false}
          />
        )
      },
    },
    {
      accessorKey: 'reason',
      header: t('Reason'),
      cell: ({ row }) => (
        <div className='max-w-64 space-y-0.5'>
          <div>{row.original.reason ? t(row.original.reason) : '—'}</div>
          {row.original.note && (
            <div className='text-muted-foreground truncate text-xs'>
              {row.original.note}
            </div>
          )}
        </div>
      ),
    },
    {
      accessorKey: 'shared_ips',
      header: t('Shared IPs'),
      cell: ({ row }) =>
        row.original.shared_ips ? (
          <div className='max-w-56 font-mono text-xs break-all'>
            {row.original.shared_ips.split(',').join(', ')}
          </div>
        ) : (
          '—'
        ),
    },
    {
      accessorKey: 'operator_id',
      header: t('Operator'),
      cell: ({ row }) =>
        row.original.operator_id === 0 ? (
          t('System')
        ) : (
          <ReferralUserCell
            id={row.original.operator_id}
            username={row.original.operator_username}
          />
        ),
    },
    {
      id: 'actions',
      header: t('Actions'),
      cell: ({ row }) =>
        row.original.restorable ? (
          <Button
            size='sm'
            variant='outline'
            onClick={() => restore(row.original)}
          >
            {t('Restore')}
          </Button>
        ) : null,
    },
  ]
  const actionLabel = t('Action')
  const toolbar = (
    <ReferralToolbar
      search={props.search}
      navigate={props.navigate}
      pageSize={pagination.pageSize}
      refreshing={query.isFetching}
      onRefresh={() => void query.refetch()}
    >
      <Combobox
        aria-label={actionLabel}
        className='w-full sm:w-40'
        options={[
          { value: '', label: actionLabel },
          ...(Object.keys(INVITE_LOG_ACTIONS) as AffiliateInviteAction[]).map(
            (value) => ({
              value,
              label: t(INVITE_LOG_ACTIONS[value].labelKey),
            })
          ),
        ]}
        value={props.search.action ?? ''}
        onValueChange={(value) =>
          changeReferralFilters(props.navigate, {
            action: (value || undefined) as AffiliateInviteAction | undefined,
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
        emptyTitle={t('No invitation logs found')}
        getRowId={(row) => String(row.id)}
        pagination={pagination}
        onPaginationChange={onPaginationChange}
        ensurePageInRange={ensurePageInRange}
      />
      <NoteActionDialog action={action} onClose={() => setAction(null)} />
    </>
  )
}
