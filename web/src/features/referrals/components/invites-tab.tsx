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
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { UserRiskBadge } from '@/features/users/components/user-risk-badge'
import { useDebounce } from '@/hooks/use-debounce'
import { useTableUrlState, type NavigateFn } from '@/hooks/use-table-url-state'
import { formatQuota } from '@/lib/format'

import {
  cancelAffiliateInvite,
  getAffiliateInvites,
  REFERRALS_QUERY_KEY,
  type ReferralsSearch,
} from '../api'
import { changeReferralFilters } from '../lib/referral-filters'
import type { AffiliateInvite } from '../types'
import { NoteActionDialog, type ReferralNoteAction } from './note-action-dialog'
import {
  ReferralTable,
  ReferralToolbar,
  ReferralUserCell,
} from './referral-table'

type InvitesTabProps = { search: ReferralsSearch; navigate: NavigateFn }

export function InvitesTab(props: InvitesTabProps) {
  const { t } = useTranslation()
  const [action, setAction] = useState<ReferralNoteAction | null>(null)
  const { pagination, onPaginationChange, ensurePageInRange } =
    useTableUrlState({
      search: props.search,
      navigate: props.navigate,
      globalFilter: { enabled: false },
      pagination: { defaultPageSize: 20 },
    })
  const keyword = useDebounce(props.search.keyword ?? '')
  const userId = useDebounce(props.search.user_id)
  const params = {
    keyword,
    user_id: userId,
    page: pagination.pageIndex + 1,
    pageSize: pagination.pageSize,
  }
  const query = useQuery({
    queryKey: [REFERRALS_QUERY_KEY, 'invites', params],
    queryFn: ({ signal }) => getAffiliateInvites(params, signal),
    enabled:
      keyword === (props.search.keyword ?? '') &&
      userId === props.search.user_id,
    meta: { errorToast: false },
  })
  const cancel = (invite: AffiliateInvite) =>
    setAction({
      key: `cancel-invite-${invite.invitee_id}`,
      title: t('Cancel invitation'),
      desc: t(
        'The invitee will no longer count as invited. Rebates still waiting for confirmation are rejected; credited rewards are kept.'
      ),
      subject: (
        <p className='text-sm'>
          {invite.invitee_username} #{invite.invitee_id} ←{' '}
          {invite.inviter_username} #{invite.inviter_id}
        </p>
      ),
      confirmText: t('Cancel invitation'),
      destructive: true,
      successMessage: t('Invitation cancelled'),
      run: (note) => cancelAffiliateInvite(invite.invitee_id, note),
    })
  const columns: ColumnDef<AffiliateInvite, unknown>[] = [
    {
      accessorKey: 'invitee_id',
      header: t('Invitee'),
      cell: ({ row }) => (
        <div className='flex items-center gap-1.5'>
          <ReferralUserCell
            id={row.original.invitee_id}
            username={row.original.invitee_username}
          />
          <UserRiskBadge risk={row.original.risk_score ?? undefined} />
        </div>
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
      accessorKey: 'created_at',
      header: t('Registered'),
      cell: ({ row }) => (
        <TimestampCell
          timestamp={row.original.created_at}
          format='absolute'
          justNowLabel={t('Just now')}
        />
      ),
    },
    {
      accessorKey: 'confirmed_quota',
      header: t('Credited rebates'),
      cell: ({ row }) => formatQuota(row.original.confirmed_quota),
    },
    {
      accessorKey: 'pending_quota',
      header: t('Unconfirmed rebates'),
      cell: ({ row }) => formatQuota(row.original.pending_quota),
    },
    {
      id: 'actions',
      header: t('Actions'),
      cell: ({ row }) => (
        <Button
          size='sm'
          variant='outline'
          onClick={() => cancel(row.original)}
        >
          {t('Cancel invitation')}
        </Button>
      ),
    },
  ]
  const toolbar = (
    <ReferralToolbar
      search={props.search}
      navigate={props.navigate}
      pageSize={pagination.pageSize}
      refreshing={query.isFetching}
      onRefresh={() => void query.refetch()}
    >
      <Input
        aria-label={t('Search invitees')}
        placeholder={t('Search by invitee username or display name...')}
        value={props.search.keyword ?? ''}
        maxLength={255}
        onChange={(event) =>
          changeReferralFilters(props.navigate, {
            keyword: event.target.value,
          })
        }
        className='min-w-52 flex-1'
      />
    </ReferralToolbar>
  )
  return (
    <>
      <ReferralTable
        query={query}
        columns={columns}
        toolbar={toolbar}
        emptyTitle={t('No invitations found')}
        getRowId={(row) => String(row.invitee_id)}
        pagination={pagination}
        onPaginationChange={onPaginationChange}
        ensurePageInRange={ensurePageInRange}
      />
      <NoteActionDialog action={action} onClose={() => setAction(null)} />
    </>
  )
}
