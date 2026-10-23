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
import { CalendarClock, Coins, Gift, Users } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { StatusBadge } from '@/components/status-badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { toIntlLocale } from '@/i18n/languages'
import { formatQuotaWithCurrency } from '@/lib/currency'
import { formatNumber, formatTimestamp } from '@/lib/format'

import {
  LOTTERY_DELIVERY_STATUSES,
  LOTTERY_MODES,
  LOTTERY_PRIZE_TYPES,
  LOTTERY_PROBABILITY_SCALE,
  LOTTERY_RANK_METRICS,
  LOTTERY_STATUSES,
} from '../constants'
import { getLiveOdds } from '../lib/activity-odds'
import { getActivityAvailability } from '../lib/activity-state'
import {
  formatLeaderboardScore,
  leaderboardRankRanges,
} from '../lib/leaderboard'
import type { LotteryActivityView, LotteryEntry, LotteryPrize } from '../types'
import { ActivityLeaderboard } from './activity-leaderboard'
import { ActivityRules } from './activity-rules'
import { ActivityWinners } from './activity-winners'
import { LuckyWheel } from './lucky-wheel'

type ActivityCardProps = {
  activity: LotteryActivityView
  nowSeconds: number
  joining: boolean
  onJoin: (activity: LotteryActivityView) => void
  onSpin: (activity: LotteryActivityView) => Promise<LotteryEntry | null>
  onSpinSettled: (activity: LotteryActivityView, entry: LotteryEntry) => void
}

function usePrizeValueText() {
  const { t } = useTranslation()
  return (prize: Pick<LotteryPrize, 'type' | 'quota' | 'name'>) => {
    if (prize.type === 'quota') {
      return formatQuotaWithCurrency(prize.quota, { abbreviate: false })
    }
    return t(LOTTERY_PRIZE_TYPES[prize.type].labelKey)
  }
}

function windowText(
  start: number,
  end: number,
  t: (key: string, options?: Record<string, string>) => string
): string {
  if (start > 0 && end > 0) {
    return t('{{start}} to {{end}}', {
      start: formatTimestamp(start),
      end: formatTimestamp(end),
    })
  }
  if (start > 0) return t('From {{time}}', { time: formatTimestamp(start) })
  if (end > 0) return t('Until {{time}}', { time: formatTimestamp(end) })
  return t('No time limit')
}

export function ActivityCard(props: ActivityCardProps) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const prizeValueText = usePrizeValueText()
  const activity = props.activity
  const availability = getActivityAvailability(activity, props.nowSeconds)
  const odds = getLiveOdds(activity)
  const percent = (chance: number) => `${formatNumber(chance * 100, locale)}%`
  const status = LOTTERY_STATUSES[activity.status]
  const isWheel = activity.mode === 'wheel'
  const isLeaderboard = activity.mode === 'leaderboard'
  const rankRanges = isLeaderboard ? leaderboardRankRanges(activity.prizes) : []

  let spinsText: string | null = null
  if (isWheel) {
    const parts: string[] = []
    if (availability.spinsLeft !== null) {
      parts.push(t('{{count}} spins left', { count: availability.spinsLeft }))
    }
    if (availability.spinsLeftToday !== null) {
      parts.push(
        t('{{count}} left today', { count: availability.spinsLeftToday })
      )
    }
    spinsText = parts.length > 0 ? parts.join(' · ') : t('Unlimited spins')
  }

  let resultText: string | null = null
  if (!isWheel && activity.status === 'drawn' && activity.me.joined) {
    resultText =
      activity.me.wins.length > 0
        ? t('You won {{prize}}', { prize: activity.me.wins[0].prize_name })
        : t('Not won this time')
  }
  // An ended wheel can no longer turn, so only its outcome is shown.
  const showWheel =
    availability.action === 'spin' && availability.phase !== 'closed'

  return (
    <Card>
      <CardHeader>
        <CardTitle className='flex min-w-0 items-center gap-2'>
          <Gift className='text-primary size-4 shrink-0' aria-hidden='true' />
          <span className='truncate'>{activity.title}</span>
        </CardTitle>
        <CardDescription>
          {t(LOTTERY_MODES[activity.mode].labelKey)}
        </CardDescription>
        <CardAction className='flex items-center gap-2'>
          <ActivityRules title={activity.title} rules={activity.rules ?? ''} />
          <StatusBadge
            label={t(status.labelKey)}
            variant={status.variant}
            copyable={false}
          />
        </CardAction>
      </CardHeader>
      <CardContent className='grid gap-6 text-sm lg:grid-cols-[minmax(0,1fr)_20rem]'>
        <div className='flex min-w-0 flex-col gap-4'>
          {activity.description ? (
            <p className='text-muted-foreground whitespace-pre-wrap'>
              {activity.description}
            </p>
          ) : null}

          <dl className='grid gap-2'>
            <div className='flex items-start gap-2'>
              <dt className='sr-only'>{t('Activity time')}</dt>
              <CalendarClock
                className='text-muted-foreground mt-0.5 size-4 shrink-0'
                aria-hidden='true'
              />
              <dd className='min-w-0'>
                {windowText(activity.start_time, activity.end_time, t)}
                {activity.mode === 'scheduled' ? (
                  <span className='text-muted-foreground block'>
                    {t('Draws at {{time}}', {
                      time: formatTimestamp(activity.draw_time),
                    })}
                  </span>
                ) : null}
              </dd>
            </div>
            {!isWheel && !isLeaderboard ? (
              <div className='flex items-start gap-2'>
                <dt className='sr-only'>{t('Participants')}</dt>
                <Users
                  className='text-muted-foreground mt-0.5 size-4 shrink-0'
                  aria-hidden='true'
                />
                <dd>
                  {activity.mode === 'participants'
                    ? t('{{count}} / {{target}} joined, draws when full', {
                        count: activity.entry_count,
                        target: activity.target_participants,
                      })
                    : t('{{count}} joined', { count: activity.entry_count })}
                </dd>
              </div>
            ) : null}
            <div className='flex items-start gap-2'>
              <dt className='sr-only'>{t('Requirement')}</dt>
              <Coins
                className='text-muted-foreground mt-0.5 size-4 shrink-0'
                aria-hidden='true'
              />
              <dd className='min-w-0 space-y-1'>
                {isLeaderboard && activity.rank_metric ? (
                  <div>
                    <span>
                      {t('Ranked by {{metric}}', {
                        metric: t(
                          LOTTERY_RANK_METRICS[activity.rank_metric].labelKey
                        ),
                      })}
                    </span>
                    <span className='text-muted-foreground block'>
                      {activity.rank_min_value > 0
                        ? t('At least {{value}} to be ranked', {
                            value: formatLeaderboardScore(
                              activity.rank_metric,
                              activity.rank_min_value,
                              locale
                            ),
                          })
                        : t('No threshold')}
                    </span>
                  </div>
                ) : null}
                {activity.min_spend > 0 ? (
                  <div>
                    <span>
                      {t('Paid at least {{amount}}', {
                        amount: formatNumber(activity.min_spend, locale),
                      })}
                    </span>
                    <span className='text-muted-foreground block'>
                      {t('Spending window: {{window}}', {
                        window: windowText(
                          activity.spend_start_time,
                          activity.spend_end_time,
                          t
                        ),
                      })}
                    </span>
                    <span
                      className={
                        activity.me.paid + 1e-9 >= activity.min_spend
                          ? 'text-success'
                          : 'text-warning'
                      }
                    >
                      {t('You paid {{paid}} of {{required}}', {
                        paid: formatNumber(activity.me.paid, locale),
                        required: formatNumber(activity.min_spend, locale),
                      })}
                    </span>
                  </div>
                ) : null}
                {activity.min_invites > 0 ? (
                  <div>
                    <span>
                      {t('Invited at least {{count}} users', {
                        count: activity.min_invites,
                      })}
                    </span>
                    <span className='text-muted-foreground block'>
                      {t('Invitation window: {{window}}', {
                        window: windowText(
                          activity.invite_start_time,
                          activity.invite_end_time,
                          t
                        ),
                      })}
                    </span>
                    <span
                      className={
                        activity.me.invited >= activity.min_invites
                          ? 'text-success'
                          : 'text-warning'
                      }
                    >
                      {t('Invited {{invited}} / {{required}}', {
                        invited: formatNumber(activity.me.invited, locale),
                        required: formatNumber(activity.min_invites, locale),
                      })}
                    </span>
                  </div>
                ) : null}
                {!isLeaderboard &&
                activity.min_spend <= 0 &&
                activity.min_invites <= 0
                  ? t('No requirement')
                  : null}
              </dd>
            </div>
          </dl>

          <ul className='grid gap-2 sm:grid-cols-2' aria-label={t('Prizes')}>
            {activity.prizes.map((prize, index) => {
              let quantityText = t('{{count}} winners', {
                count: prize.quantity,
              })
              if (isLeaderboard) {
                const range = rankRanges[index]
                quantityText =
                  range.from === range.to
                    ? t('Rank {{rank}}', { rank: range.from })
                    : t('Ranks {{from}}–{{to}}', range)
              }
              if (isWheel) {
                quantityText =
                  prize.quantity > 0
                    ? t('{{left}} of {{total}} left', {
                        left: Math.max(prize.quantity - prize.awarded, 0),
                        total: prize.quantity,
                      })
                    : t('Unlimited stock')
              }
              return (
                <li
                  key={prize.id}
                  className='flex items-center justify-between gap-3 rounded-md border px-3 py-2'
                >
                  <div className='min-w-0'>
                    <div className='truncate font-medium'>{prize.name}</div>
                    <div className='text-muted-foreground text-xs'>
                      {prizeValueText(prize)}
                    </div>
                  </div>
                  <div className='text-muted-foreground shrink-0 text-right text-xs tabular-nums'>
                    {odds ? (
                      <div>
                        {t('Live {{percent}}', {
                          percent: percent(odds.byPrize.get(prize.id) ?? 0),
                        })}
                      </div>
                    ) : null}
                    {isWheel &&
                    odds?.byPrize.get(prize.id) !==
                      prize.probability / LOTTERY_PROBABILITY_SCALE ? (
                      <div className='line-through'>
                        {percent(prize.probability / LOTTERY_PROBABILITY_SCALE)}
                      </div>
                    ) : null}
                    <div>{quantityText}</div>
                  </div>
                </li>
              )
            })}
          </ul>

          <ActivityWinners
            winners={activity.winners}
            total={activity.winner_count}
          />

          {activity.me.wins.length > 0 ? (
            <div className='grid gap-1'>
              <div className='font-medium'>{t('My prizes')}</div>
              <ul className='grid gap-1'>
                {activity.me.wins.map((win) => {
                  const delivery =
                    LOTTERY_DELIVERY_STATUSES[win.delivery_status]
                  return (
                    <li
                      key={win.id}
                      className='flex items-center justify-between gap-2'
                    >
                      <span className='truncate'>{win.prize_name}</span>
                      <StatusBadge
                        label={t(delivery.labelKey)}
                        variant={delivery.variant}
                        copyable={false}
                      />
                    </li>
                  )
                })}
              </ul>
            </div>
          ) : null}
        </div>
        <div className='bg-muted/30 flex flex-col items-stretch justify-center gap-2 rounded-lg border p-4'>
          {isLeaderboard ? <ActivityLeaderboard activity={activity} /> : null}
          {showWheel ? (
            <LuckyWheel
              prizes={activity.prizes}
              disabled={availability.blockedReason !== null}
              onSpin={() => props.onSpin(activity)}
              onSettled={(entry) => props.onSpinSettled(activity, entry)}
            />
          ) : null}
          {availability.action === 'join' ? (
            <Button
              className='w-full'
              onClick={() => props.onJoin(activity)}
              disabled={availability.blockedReason !== null || props.joining}
            >
              {activity.me.joined ? t('Joined') : t('Join')}
            </Button>
          ) : null}
          {odds ? (
            <div className='text-center'>
              <div className='text-muted-foreground text-xs'>
                {t('Current chance to win')}
              </div>
              <div className='text-primary text-2xl font-semibold tabular-nums'>
                {percent(odds.overall)}
              </div>
              {odds.entrants !== null ? (
                <div className='text-muted-foreground text-xs'>
                  {activity.me.joined
                    ? t('Based on {{count}} entrants', { count: odds.entrants })
                    : t('Based on {{count}} entrants if you join', {
                        count: odds.entrants,
                      })}
                </div>
              ) : null}
            </div>
          ) : null}
          {resultText ? (
            <p className='text-center font-medium'>{resultText}</p>
          ) : null}
          {activity.status === 'cancelled' ? (
            <p className='text-muted-foreground text-center font-medium'>
              {t('This activity was cancelled')}
            </p>
          ) : null}
          {activity.status === 'drawn' ? (
            <p className='text-muted-foreground text-center text-xs'>
              {t('Drawn at {{time}}', {
                time: formatTimestamp(activity.drawn_at),
              })}
            </p>
          ) : null}
          {availability.blockedReason ? (
            <p className='text-muted-foreground text-center text-xs'>
              {t(availability.blockedReason)}
            </p>
          ) : null}
          {spinsText && showWheel ? (
            <p className='text-muted-foreground text-center text-xs'>
              {spinsText}
            </p>
          ) : null}
        </div>
      </CardContent>
    </Card>
  )
}
