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
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { TimestampCell } from '@/components/activity-time-cell'
import { ConfirmDialog } from '@/components/confirm-dialog'
import {
  DataTableRowActionMenu,
  StaticDataTable,
  type StaticDataTableColumn,
} from '@/components/data-table'
import { StatusBadge } from '@/components/status-badge'
import { Button } from '@/components/ui/button'
import { DropdownMenuItem } from '@/components/ui/dropdown-menu'
import { handleServerError } from '@/lib/handle-server-error'
import { requireServerSuccess } from '@/lib/server-error-message'

import {
  activitiesQueryKeys,
  cancelActivity,
  deleteActivity,
  drawActivity,
  getAdminActivities,
} from '../../api'
import { LOTTERY_MODES, LOTTERY_STATUSES } from '../../constants'
import type { ApiResponse, LotteryActivity } from '../../types'
import { ActivityEntriesDialog } from './activity-entries-dialog'
import { ActivityMutateDrawer } from './activity-mutate-drawer'

type PendingAction = {
  kind: 'draw' | 'award' | 'cancel' | 'delete'
  activity: LotteryActivity
}

const ACTION_REQUESTS: Record<
  PendingAction['kind'],
  (id: number) => Promise<ApiResponse>
> = {
  draw: drawActivity,
  // A locked leaderboard is awarded through the draw endpoint.
  award: drawActivity,
  cancel: cancelActivity,
  delete: deleteActivity,
}

export function ActivitiesAdmin() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [editing, setEditing] = useState<LotteryActivity | undefined>()
  const [viewing, setViewing] = useState<LotteryActivity | null>(null)
  const [pending, setPending] = useState<PendingAction | null>(null)
  const { data, isPending } = useQuery({
    queryKey: activitiesQueryKeys.admin(),
    queryFn: async () =>
      requireServerSuccess(await getAdminActivities()).data ?? [],
  })
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: activitiesQueryKeys.all })

  const runAction = useMutation({
    mutationFn: async (action: PendingAction) =>
      requireServerSuccess(
        await ACTION_REQUESTS[action.kind](action.activity.id)
      ),
    onSuccess: () => {
      toast.success(t('Updated successfully'))
      setPending(null)
      void refresh()
    },
    onError: (error) => handleServerError(error),
  })

  const openDrawer = (activity?: LotteryActivity) => {
    setEditing(activity)
    setDrawerOpen(true)
  }

  const columns: StaticDataTableColumn<LotteryActivity>[] = [
    {
      id: 'title',
      header: t('Activity'),
      cell: (activity) => (
        <div className='min-w-0'>
          <div className='truncate font-medium'>{activity.title}</div>
          <div className='text-muted-foreground text-xs'>
            {t(LOTTERY_MODES[activity.mode].labelKey)}
          </div>
        </div>
      ),
    },
    {
      id: 'status',
      header: t('Status'),
      cell: (activity) => {
        const status = LOTTERY_STATUSES[activity.status]
        return (
          <StatusBadge
            label={t(status.labelKey)}
            variant={status.variant}
            copyable={false}
          />
        )
      },
    },
    {
      id: 'entries',
      header: t('Entries'),
      cellClassName: 'tabular-nums',
      cell: (activity) =>
        activity.mode === 'participants'
          ? `${activity.entry_count} / ${activity.target_participants}`
          : activity.entry_count,
    },
    {
      id: 'prizes',
      header: t('Prizes'),
      cell: (activity) => (
        <span className='line-clamp-2'>
          {activity.prizes.map((prize) => prize.name).join(', ')}
        </span>
      ),
    },
    {
      id: 'time',
      header: t('Ends / draws'),
      cell: (activity) => (
        <TimestampCell
          timestamp={activity.draw_time || activity.end_time}
          format='absolute'
          justNowLabel={t('Just now')}
        />
      ),
    },
    {
      id: 'actions',
      header: <span className='sr-only'>{t('Actions')}</span>,
      className: 'text-right',
      cellClassName: 'text-right',
      cell: (activity) => {
        const editable =
          activity.status === 'draft' || activity.status === 'active'
        const isLeaderboard = activity.mode === 'leaderboard'
        return (
          <div className='flex justify-end gap-1'>
            <Button
              size='sm'
              variant='ghost'
              onClick={() => setViewing(activity)}
            >
              {t('Entries')}
            </Button>
            <DataTableRowActionMenu ariaLabel={t('More actions')}>
              <DropdownMenuItem
                onClick={() => openDrawer(activity)}
                disabled={!editable}
              >
                {t('Edit')}
              </DropdownMenuItem>
              {activity.mode !== 'wheel' && !isLeaderboard ? (
                <DropdownMenuItem
                  onClick={() => setPending({ kind: 'draw', activity })}
                  disabled={activity.status !== 'active'}
                >
                  {t('Draw now')}
                </DropdownMenuItem>
              ) : null}
              {isLeaderboard ? (
                <DropdownMenuItem
                  onClick={() => setPending({ kind: 'award', activity })}
                  disabled={activity.status !== 'ranked'}
                >
                  {t('Award prizes')}
                </DropdownMenuItem>
              ) : null}
              <DropdownMenuItem
                onClick={() => setPending({ kind: 'cancel', activity })}
                disabled={!editable && activity.status !== 'ranked'}
              >
                {t('Cancel activity')}
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => setPending({ kind: 'delete', activity })}
                disabled={activity.entry_count > 0}
                className='text-destructive focus:text-destructive'
              >
                {t('Delete')}
              </DropdownMenuItem>
            </DataTableRowActionMenu>
          </div>
        )
      },
    },
  ]

  const confirmCopy: Record<
    PendingAction['kind'],
    { title: string; desc: string; destructive: boolean }
  > = {
    draw: {
      title: t('Draw this activity now?'),
      desc: t(
        'Winners are picked from the current entries and prizes are delivered right away.'
      ),
      destructive: false,
    },
    award: {
      title: t('Award the prizes of this leaderboard?'),
      desc: t(
        'Prizes go to the qualified users in rank order; balance and subscription prizes are delivered right away.'
      ),
      destructive: false,
    },
    cancel: {
      title: t('Cancel this activity?'),
      desc: t(
        'Users can no longer enter. Prizes already won stay with their winners.'
      ),
      destructive: true,
    },
    delete: {
      title: t('Delete this activity?'),
      desc: t('This cannot be undone.'),
      destructive: true,
    },
  }
  const copy = pending ? confirmCopy[pending.kind] : null

  return (
    <div className='grid gap-4'>
      <div className='flex justify-end'>
        <Button size='sm' onClick={() => openDrawer()}>
          <Plus className='size-4' />
          {t('Create activity')}
        </Button>
      </div>
      {isPending ? (
        <p className='text-muted-foreground text-sm'>{t('Loading...')}</p>
      ) : (
        <StaticDataTable
          columns={columns}
          data={data ?? []}
          getRowKey={(activity) => activity.id}
          emptyContent={t('No activities yet')}
        />
      )}
      <ActivityMutateDrawer
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        activity={editing}
        onSaved={() => void refresh()}
      />
      <ActivityEntriesDialog
        activity={viewing}
        onOpenChange={(open) => {
          if (!open) setViewing(null)
        }}
      />
      <ConfirmDialog
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open) setPending(null)
        }}
        title={copy?.title ?? ''}
        desc={copy ? `${pending?.activity.title}: ${copy.desc}` : ''}
        destructive={copy?.destructive}
        isLoading={runAction.isPending}
        handleConfirm={() => {
          if (pending) runAction.mutate(pending)
        }}
      />
    </div>
  )
}
