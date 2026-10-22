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
import { ChevronDown, Gift } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { EmptyState } from '@/components/empty-state'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { handleServerError } from '@/lib/handle-server-error'
import { requireServerSuccess } from '@/lib/server-error-message'

import {
  activitiesQueryKeys,
  getActivities,
  joinActivity,
  spinWheel,
} from '../api'
import { isHistoryActivity } from '../lib/activity-state'
import type { LotteryActivityView, LotteryEntry } from '../types'
import { ActivityCard } from './activity-card'

const ACTIVITIES_REFRESH_MS = 60_000

function useNowSeconds(): number {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000))
  useEffect(() => {
    const timer = window.setInterval(
      () => setNow(Math.floor(Date.now() / 1000)),
      30_000
    )
    return () => window.clearInterval(timer)
  }, [])
  return now
}

export function ActivitiesList() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const nowSeconds = useNowSeconds()
  const { data, isPending } = useQuery({
    queryKey: activitiesQueryKeys.list(),
    queryFn: async () => requireServerSuccess(await getActivities()).data ?? [],
    // Entries, stock and draws change as other users take part; refresh
    // while something is still running. Hidden tabs do not poll.
    refetchInterval: (query) => {
      const nowSeconds = Math.floor(Date.now() / 1000)
      const running = (query.state.data ?? []).some(
        (activity) => !isHistoryActivity(activity, nowSeconds)
      )
      return running ? ACTIVITIES_REFRESH_MS : false
    },
  })
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: activitiesQueryKeys.all })

  const join = useMutation({
    mutationFn: async (activity: LotteryActivityView) =>
      requireServerSuccess(await joinActivity(activity.id)),
    onSuccess: () => {
      toast.success(t('Joined the activity'))
      void refresh()
    },
    onError: (error) => handleServerError(error),
  })

  const spin = async (
    activity: LotteryActivityView
  ): Promise<LotteryEntry | null> => {
    try {
      const response = requireServerSuccess(await spinWheel(activity.id))
      return response.data ?? null
    } catch (error) {
      handleServerError(error)
      void refresh()
      return null
    }
  }

  const handleSpinSettled = (_: LotteryActivityView, entry: LotteryEntry) => {
    if (entry.prize_id > 0) {
      toast.success(t('You won {{prize}}', { prize: entry.prize_name }))
    } else {
      toast(t('Not won this time'))
    }
    void refresh()
  }

  if (isPending) {
    return <p className='text-muted-foreground text-sm'>{t('Loading...')}</p>
  }
  if (!data || data.length === 0) {
    return (
      <EmptyState
        icon={Gift}
        title={t('No activities yet')}
        description={t('Check back later for new activities.')}
      />
    )
  }
  const renderCard = (activity: LotteryActivityView) => (
    <ActivityCard
      key={activity.id}
      activity={activity}
      nowSeconds={nowSeconds}
      joining={join.isPending && join.variables?.id === activity.id}
      onJoin={(target) => join.mutate(target)}
      onSpin={spin}
      onSpinSettled={handleSpinSettled}
    />
  )
  const current = data.filter(
    (activity) => !isHistoryActivity(activity, nowSeconds)
  )
  const history = data.filter((activity) =>
    isHistoryActivity(activity, nowSeconds)
  )

  return (
    <div className='flex flex-col gap-4'>
      {current.length > 0 ? (
        current.map(renderCard)
      ) : (
        <EmptyState
          icon={Gift}
          title={t('No ongoing activities')}
          description={t('Check back later for new activities.')}
          className='min-h-[200px]'
        />
      )}
      {history.length > 0 ? (
        <Collapsible className='flex flex-col gap-4'>
          <CollapsibleTrigger className='text-muted-foreground hover:text-foreground group flex w-fit items-center gap-1.5 text-sm font-medium transition-colors'>
            <ChevronDown
              className='size-4 transition-transform group-data-[panel-open]:rotate-180'
              aria-hidden='true'
            />
            {t('Past activities ({{count}})', { count: history.length })}
          </CollapsibleTrigger>
          <CollapsibleContent className='flex flex-col gap-4'>
            {history.map(renderCard)}
          </CollapsibleContent>
        </Collapsible>
      ) : null}
    </div>
  )
}
