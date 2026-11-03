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
import type { LeaderboardRow } from '../types'

/** Where the finish line sits along the track, in percent. */
export const RACE_FINISH_PERCENT = 92

/**
 * How far along the track each of the top three has run, in percent. The
 * leader runs ahead and crosses the line once the ranks are final; the others
 * trail by their share of the leader's score.
 */
export function racePositions(
  rows: LeaderboardRow[],
  final: boolean
): Map<number, number> {
  const positions = new Map<number, number>()
  const leaderScore = rows.find((row) => row.rank === 1)?.score ?? 0
  for (const row of rows) {
    if (row.rank === 1) {
      positions.set(row.user_id, final ? RACE_FINISH_PERCENT + 1 : 80)
      continue
    }
    const share = leaderScore > 0 ? row.score / leaderScore : 0
    positions.set(row.user_id, Math.min(12 + share * 62, 76))
  }
  return positions
}

/**
 * The users in each lane. Runners keep their lanes while the same users hold
 * the top three, so an overtake shows as one runner passing another.
 */
export function keepLanes(
  previous: number[],
  rows: LeaderboardRow[]
): number[] {
  const ids = rows.map((row) => row.user_id)
  const sameRunners =
    previous.length === ids.length && ids.every((id) => previous.includes(id))
  return sameRunners ? previous : ids
}

/** Users who now hold a better rank than in the previous standings. */
export function rankClimbers(
  previous: LeaderboardRow[],
  rows: LeaderboardRow[]
): number[] {
  const before = new Map(previous.map((row) => [row.user_id, row.rank]))
  return rows
    .filter((row) => {
      const rank = before.get(row.user_id)
      return rank !== undefined && row.rank < rank
    })
    .map((row) => row.user_id)
}
