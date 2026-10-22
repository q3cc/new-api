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

import { getLiveOdds } from '../lib/activity-odds'
import type { LotteryActivityView, LotteryPrize } from '../types'

function prize(
  id: number,
  overrides: Partial<LotteryPrize> = {}
): LotteryPrize {
  return {
    id,
    activity_id: 1,
    name: `Prize ${id}`,
    type: 'quota',
    quota: 100,
    plan_id: 0,
    quantity: 1,
    awarded: 0,
    probability: 0,
    sort_order: id,
    ...overrides,
  }
}

function activity(
  overrides: Partial<LotteryActivityView>,
  joined = false
): LotteryActivityView {
  return {
    id: 1,
    title: 'Draw',
    description: '',
    mode: 'participants',
    status: 'active',
    start_time: 0,
    end_time: 0,
    draw_time: 0,
    target_participants: 10,
    min_spend: 0,
    spend_start_time: 0,
    spend_end_time: 0,
    wheel_total_limit: 0,
    wheel_daily_limit: 0,
    entry_count: 0,
    drawn_at: 0,
    created_at: 0,
    updated_at: 0,
    prizes: [],
    winners: [],
    winner_count: 0,
    me: {
      paid: 0,
      eligible: true,
      joined,
      spins_used: 0,
      spins_used_today: 0,
      wins: [],
    },
    ...overrides,
  }
}

describe('getLiveOdds', () => {
  it('drops a sold-out wheel prize to zero and keeps the others as configured', () => {
    const odds = getLiveOdds(
      activity({
        mode: 'wheel',
        prizes: [
          prize(1, { probability: 6000, quantity: 1, awarded: 1 }),
          prize(2, { probability: 3000, quantity: 0 }),
        ],
      })
    )
    expect(odds?.byPrize.get(1)).toBe(0)
    expect(odds?.byPrize.get(2)).toBeCloseTo(0.3)
    expect(odds?.overall).toBeCloseTo(0.3)
    expect(odds?.entrants).toBeNull()
  })

  it('counts a user who has not joined as one more entrant', () => {
    const odds = getLiveOdds(
      activity({ entry_count: 3, prizes: [prize(1, { quantity: 2 })] })
    )
    expect(odds?.entrants).toBe(4)
    expect(odds?.overall).toBe(0.5)
  })

  it('hands out prizes in order among the current entrants', () => {
    const odds = getLiveOdds(
      activity(
        {
          entry_count: 3,
          prizes: [prize(1, { quantity: 2 }), prize(2, { quantity: 5 })],
        },
        true
      )
    )
    expect(odds?.entrants).toBe(3)
    expect(odds?.byPrize.get(1)).toBeCloseTo(2 / 3)
    expect(odds?.byPrize.get(2)).toBeCloseTo(1 / 3)
    expect(odds?.overall).toBe(1)
  })

  it('has no odds for a full draw the user is not in', () => {
    const full = { entry_count: 5, target_participants: 5 }
    expect(getLiveOdds(activity({ ...full, prizes: [prize(1)] }))).toBeNull()
    expect(
      getLiveOdds(activity({ ...full, prizes: [prize(1)] }, true))?.overall
    ).toBe(0.2)
  })

  it('has no odds once the activity is drawn', () => {
    expect(getLiveOdds(activity({ status: 'drawn' }))).toBeNull()
  })
})
