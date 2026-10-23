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
import { formatQuotaWithCurrency } from '@/lib/currency'
import { formatNumber } from '@/lib/format'

import type { LotteryRankMetric } from '../types'

export type RankRange = { from: number; to: number }

/**
 * The ranks each leaderboard prize covers: prizes take consecutive ranks in
 * their order, as many as their quantity.
 */
export function leaderboardRankRanges(
  prizes: { quantity: number }[]
): RankRange[] {
  let next = 1
  return prizes.map((prize) => {
    const count = Math.max(prize.quantity, 0)
    const range = { from: next, to: next + count - 1 }
    next += count
    return range
  })
}

/** A leaderboard score in its metric's unit; consumption is quota. */
export function formatLeaderboardScore(
  metric: LotteryRankMetric | '',
  score: number,
  locale: string | undefined
): string {
  if (metric === 'consumption') {
    return formatQuotaWithCurrency(score, { abbreviate: false })
  }
  return formatNumber(score, locale)
}
