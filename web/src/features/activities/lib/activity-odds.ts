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
import { LOTTERY_PROBABILITY_SCALE } from '../constants'
import type { LotteryActivityView } from '../types'

export type LiveOdds = {
  /** Chance of winning any prize, 0–1. */
  overall: number
  /** Chance of winning each prize, keyed by prize ID, 0–1. */
  byPrize: Map<number, number>
  /** Entrants the draw odds are based on; null for a wheel. */
  entrants: number | null
}

/**
 * The current chance of winning, from the latest counts.
 *
 * A wheel keeps each prize's configured odds until its stock runs out; after
 * that, landing on it wins nothing. A draw hands out prizes in order among
 * the current entrants, counting the user as one if they have not joined.
 * Drawn and cancelled activities, and full draws the user is not in, have no
 * odds left.
 */
export function getLiveOdds(activity: LotteryActivityView): LiveOdds | null {
  if (activity.status === 'drawn' || activity.status === 'cancelled') {
    return null
  }
  const byPrize = new Map<number, number>()
  if (activity.mode === 'wheel') {
    let overall = 0
    for (const prize of activity.prizes) {
      const soldOut = prize.quantity > 0 && prize.awarded >= prize.quantity
      const chance = soldOut ? 0 : prize.probability / LOTTERY_PROBABILITY_SCALE
      byPrize.set(prize.id, chance)
      overall += chance
    }
    return { overall: Math.min(overall, 1), byPrize, entrants: null }
  }

  const isFull =
    activity.mode === 'participants' &&
    activity.entry_count >= activity.target_participants
  // A full draw takes no more entries, so there is nothing to win by joining.
  if (isFull && !activity.me.joined) return null
  const entrants = activity.entry_count + (activity.me.joined ? 0 : 1)
  let remainingEntrants = entrants
  let winners = 0
  for (const prize of activity.prizes) {
    const prizeWinners = Math.min(prize.quantity, remainingEntrants)
    byPrize.set(prize.id, prizeWinners / entrants)
    remainingEntrants -= prizeWinners
    winners += prizeWinners
  }
  return { overall: winners / entrants, byPrize, entrants }
}
