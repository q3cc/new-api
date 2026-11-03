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
import { describe, expect, it } from 'vitest'

import {
  keepLanes,
  racePositions,
  rankClimbers,
  RACE_FINISH_PERCENT,
} from '../lib/leaderboard-scene'
import type { LeaderboardRow } from '../types'

function row(userId: number, rank: number, score: number): LeaderboardRow {
  return { user_id: userId, display_name: '', rank, score }
}

describe('racePositions', () => {
  it('runs the leader ahead and spaces the others by their share of its score', () => {
    const positions = racePositions([row(1, 1, 100), row(2, 2, 50)], false)

    expect(positions.get(1)).toBe(80)
    expect(positions.get(2)).toBe(43)
  })

  it('takes the leader across the finish line once the ranks are final', () => {
    const positions = racePositions([row(1, 1, 100)], true)

    expect(positions.get(1)).toBeGreaterThan(RACE_FINISH_PERCENT)
  })

  it('keeps a runner tied with the leader behind it', () => {
    const positions = racePositions([row(1, 1, 100), row(2, 2, 100)], false)

    expect(positions.get(2)).toBeLessThan(positions.get(1) ?? 0)
  })

  it('leaves the others at the start when the leader has no score', () => {
    const positions = racePositions([row(1, 1, 0), row(2, 2, 0)], false)

    expect(positions.get(2)).toBe(12)
  })
})

describe('keepLanes', () => {
  it('keeps the lanes while the same users hold the top three', () => {
    const lanes = keepLanes(
      [1, 2, 3],
      [row(1, 1, 9), row(3, 2, 8), row(2, 3, 7)]
    )

    expect(lanes).toEqual([1, 2, 3])
  })

  it('assigns lanes by rank when a new user enters the top three', () => {
    const lanes = keepLanes(
      [1, 2, 3],
      [row(1, 1, 9), row(4, 2, 8), row(2, 3, 7)]
    )

    expect(lanes).toEqual([1, 4, 2])
  })
})

describe('rankClimbers', () => {
  it('names users who now hold a better rank', () => {
    const before = [row(1, 1, 9), row(2, 2, 8), row(3, 3, 7)]
    const after = [row(1, 1, 9), row(3, 2, 8.5), row(2, 3, 8)]

    expect(rankClimbers(before, after)).toEqual([3])
  })

  it('ignores users who were not listed before', () => {
    expect(rankClimbers([row(1, 1, 9)], [row(5, 1, 10)])).toEqual([])
  })
})
