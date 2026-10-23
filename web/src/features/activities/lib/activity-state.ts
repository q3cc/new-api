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
import type { LotteryActivityView } from '../types'

export type ActivityPhase =
  | 'upcoming'
  | 'open'
  | 'closed'
  | 'drawn'
  | 'cancelled'

export type ActivityAvailability = {
  phase: ActivityPhase
  action: 'spin' | 'join' | null
  /** i18n key explaining why the action is unavailable. */
  blockedReason: string | null
  /** Spins left on a wheel; null when unlimited. */
  spinsLeft: number | null
  spinsLeftToday: number | null
}

function remaining(limit: number, used: number): number | null {
  return limit > 0 ? Math.max(limit - used, 0) : null
}

/**
 * What the current user can do in an activity right now. The server enforces
 * the same rules; this only decides what the page offers.
 */
export function getActivityAvailability(
  activity: LotteryActivityView,
  nowSeconds: number
): ActivityAvailability {
  const isWheel = activity.mode === 'wheel'
  const spinsLeft = isWheel
    ? remaining(activity.wheel_total_limit, activity.me.spins_used)
    : null
  const spinsLeftToday = isWheel
    ? remaining(activity.wheel_daily_limit, activity.me.spins_used_today)
    : null
  const result: ActivityAvailability = {
    phase: 'open',
    action: isWheel ? 'spin' : 'join',
    blockedReason: null,
    spinsLeft,
    spinsLeftToday,
  }

  if (activity.status === 'drawn' || activity.status === 'cancelled') {
    return {
      ...result,
      phase: activity.status,
      action: null,
    }
  }
  if (activity.start_time > 0 && nowSeconds < activity.start_time) {
    return {
      ...result,
      phase: 'upcoming',
      blockedReason: 'This activity has not started yet',
    }
  }
  if (activity.end_time > 0 && nowSeconds > activity.end_time) {
    return {
      ...result,
      phase: 'closed',
      blockedReason: isWheel
        ? 'This activity has ended'
        : 'Entries are closed; waiting for the draw',
    }
  }
  if (!isWheel && activity.me.joined) {
    return { ...result, blockedReason: 'You have joined this activity' }
  }
  if (
    activity.mode === 'participants' &&
    activity.entry_count >= activity.target_participants
  ) {
    return {
      ...result,
      blockedReason: 'This activity is full; waiting for the draw',
    }
  }
  if (!activity.me.eligible) {
    // The spending requirement is named first, as the server does.
    const missesInvitesOnly =
      activity.min_invites > 0 && activity.me.paid + 1e-9 >= activity.min_spend
    return {
      ...result,
      blockedReason: missesInvitesOnly
        ? 'You do not meet the invitation requirement of this activity'
        : 'You do not meet the spending requirement of this activity',
    }
  }
  if (spinsLeft === 0) {
    return {
      ...result,
      blockedReason: 'You have used all your spins for this activity',
    }
  }
  if (spinsLeftToday === 0) {
    return {
      ...result,
      blockedReason: 'You have used all your spins for today',
    }
  }
  return result
}

/**
 * Whether an activity is over for good: drawn, cancelled, or a wheel past its
 * end time. A draw that stopped taking entries is not history until drawn.
 */
export function isHistoryActivity(
  activity: LotteryActivityView,
  nowSeconds: number
): boolean {
  if (activity.status === 'drawn' || activity.status === 'cancelled') {
    return true
  }
  return (
    activity.mode === 'wheel' &&
    activity.end_time > 0 &&
    nowSeconds > activity.end_time
  )
}
