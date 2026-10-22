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

import { TimestampCell } from '@/components/activity-time-cell'
import {
  StaticDataTable,
  type StaticDataTableColumn,
} from '@/components/data-table'
import { EmptyState } from '@/components/empty-state'
import { StatusBadge } from '@/components/status-badge'
import { requireServerSuccess } from '@/lib/server-error-message'

import { activitiesQueryKeys, getSelfWins } from '../api'
import { LOTTERY_DELIVERY_STATUSES, LOTTERY_PRIZE_TYPES } from '../constants'
import type { LotteryWin } from '../types'

export function MyPrizes() {
  const { t } = useTranslation()
  const { data, isPending } = useQuery({
    queryKey: activitiesQueryKeys.wins(),
    queryFn: async () => requireServerSuccess(await getSelfWins()).data ?? [],
  })

  if (isPending) {
    return <p className='text-muted-foreground text-sm'>{t('Loading...')}</p>
  }
  if (!data || data.length === 0) {
    return (
      <EmptyState
        icon={Trophy}
        title={t('No prizes yet')}
        description={t('Prizes you win in activities appear here.')}
      />
    )
  }

  const columns: StaticDataTableColumn<LotteryWin>[] = [
    {
      id: 'prize',
      header: t('Prize'),
      cell: (win) => (
        <div className='min-w-0'>
          <div className='truncate font-medium'>{win.prize_name}</div>
          <div className='text-muted-foreground truncate text-xs'>
            {win.activity_title}
          </div>
        </div>
      ),
    },
    {
      id: 'type',
      header: t('Type'),
      cell: (win) =>
        win.prize_type ? t(LOTTERY_PRIZE_TYPES[win.prize_type].labelKey) : '-',
    },
    {
      id: 'status',
      header: t('Status'),
      cell: (win) => {
        const delivery = LOTTERY_DELIVERY_STATUSES[win.delivery_status]
        return (
          <StatusBadge
            label={t(delivery.labelKey)}
            variant={delivery.variant}
            copyable={false}
          />
        )
      },
    },
    {
      id: 'time',
      header: t('Won at'),
      cell: (win) => (
        <TimestampCell
          timestamp={win.created_at}
          format='absolute'
          justNowLabel={t('Just now')}
        />
      ),
    },
  ]

  return (
    <StaticDataTable
      columns={columns}
      data={data}
      getRowKey={(win) => win.id}
    />
  )
}
