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
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { TimestampCell } from '@/components/activity-time-cell'
import { ConfirmDialog } from '@/components/confirm-dialog'
import {
  StaticDataTable,
  type StaticDataTableColumn,
} from '@/components/data-table'
import { Dialog } from '@/components/dialog'
import { StatusBadge } from '@/components/status-badge'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { handleServerError } from '@/lib/handle-server-error'
import { requireServerSuccess } from '@/lib/server-error-message'

import {
  activitiesQueryKeys,
  deliverEntry,
  getActivityEntries,
} from '../../api'
import { LOTTERY_DELIVERY_STATUSES } from '../../constants'
import type { LotteryActivity, LotteryAdminEntry } from '../../types'

const PAGE_SIZE = 20

type ActivityEntriesDialogProps = {
  activity: LotteryActivity | null
  onOpenChange: (open: boolean) => void
}

export function ActivityEntriesDialog(props: ActivityEntriesDialogProps) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const activityId = props.activity?.id ?? 0
  const [page, setPage] = useState(1)
  const [winnersOnly, setWinnersOnly] = useState(false)
  const [delivering, setDelivering] = useState<LotteryAdminEntry | null>(null)
  const { data, isPending } = useQuery({
    queryKey: activitiesQueryKeys.entries(activityId, page, winnersOnly),
    queryFn: async () =>
      requireServerSuccess(
        await getActivityEntries(activityId, page, PAGE_SIZE, winnersOnly)
      ).data,
    enabled: activityId > 0,
  })
  const deliver = useMutation({
    mutationFn: async (entry: LotteryAdminEntry) =>
      requireServerSuccess(await deliverEntry(entry.id)),
    onSuccess: () => {
      toast.success(t('Prize delivered'))
      setDelivering(null)
      void queryClient.invalidateQueries({
        queryKey: activitiesQueryKeys.all,
      })
    },
    onError: (error) => handleServerError(error),
  })

  const entries = data?.items ?? []
  const total = data?.total ?? 0
  const pageCount = Math.max(Math.ceil(total / PAGE_SIZE), 1)

  const columns: StaticDataTableColumn<LotteryAdminEntry>[] = [
    {
      id: 'user',
      header: t('User'),
      cell: (entry) => (
        <span className='truncate'>
          {entry.username || '-'}{' '}
          <span className='text-muted-foreground'>#{entry.user_id}</span>
        </span>
      ),
    },
    {
      id: 'prize',
      header: t('Prize'),
      cell: (entry) =>
        entry.prize_id > 0 ? (
          entry.prize_name
        ) : (
          <span className='text-muted-foreground'>{t('Not won')}</span>
        ),
    },
    {
      id: 'delivery',
      header: t('Delivery'),
      cell: (entry) => {
        if (entry.prize_id === 0) return null
        const delivery = LOTTERY_DELIVERY_STATUSES[entry.delivery_status]
        return (
          <div className='grid gap-0.5'>
            <StatusBadge
              label={t(delivery.labelKey)}
              variant={delivery.variant}
              copyable={false}
            />
            {entry.delivery_note ? (
              <span className='text-muted-foreground text-xs'>
                {t(entry.delivery_note)}
              </span>
            ) : null}
          </div>
        )
      },
    },
    {
      id: 'time',
      header: t('Time'),
      cell: (entry) => (
        <TimestampCell
          timestamp={entry.created_at}
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
      cell: (entry) => {
        if (
          entry.delivery_status === 'pending' &&
          entry.prize_type === 'manual'
        ) {
          return (
            <Button
              size='sm'
              variant='outline'
              onClick={() => setDelivering(entry)}
            >
              {t('Mark delivered')}
            </Button>
          )
        }
        if (entry.delivery_status === 'failed') {
          return (
            <Button
              size='sm'
              variant='outline'
              onClick={() => setDelivering(entry)}
            >
              {t('Retry delivery')}
            </Button>
          )
        }
        return null
      },
    },
  ]

  return (
    <>
      <Dialog
        open={props.activity !== null}
        onOpenChange={(open) => {
          if (!open) {
            setPage(1)
            setWinnersOnly(false)
          }
          props.onOpenChange(open)
        }}
        title={t('Entries of {{title}}', {
          title: props.activity?.title ?? '',
        })}
        description={t('{{count}} entries', { count: total })}
        contentClassName='sm:max-w-3xl'
      >
        <div className='grid gap-3'>
          <div className='flex items-center gap-2'>
            <Switch
              id='lottery-winners-only'
              checked={winnersOnly}
              onCheckedChange={(checked) => {
                setWinnersOnly(checked)
                setPage(1)
              }}
            />
            <Label htmlFor='lottery-winners-only'>{t('Winners only')}</Label>
          </div>
          {isPending ? (
            <p className='text-muted-foreground text-sm'>{t('Loading...')}</p>
          ) : (
            <StaticDataTable
              columns={columns}
              data={entries}
              getRowKey={(entry) => entry.id}
              emptyContent={t('No entries yet')}
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
                {t('Previous')}
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
                {t('Next')}
              </Button>
            </div>
          ) : null}
        </div>
      </Dialog>
      <ConfirmDialog
        open={delivering !== null}
        onOpenChange={(open) => {
          if (!open) setDelivering(null)
        }}
        title={
          delivering?.prize_type === 'manual'
            ? t('Mark prize as delivered?')
            : t('Retry prize delivery?')
        }
        desc={t('{{prize}} for {{user}}', {
          prize: delivering?.prize_name ?? '',
          user: delivering?.username ?? '',
        })}
        isLoading={deliver.isPending}
        handleConfirm={() => {
          if (delivering) deliver.mutate(delivering)
        }}
      />
    </>
  )
}
