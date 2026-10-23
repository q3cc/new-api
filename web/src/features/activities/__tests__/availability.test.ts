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
  getActivityAvailability,
  isHistoryActivity,
} from '../lib/activity-state'
import type { LotteryActivityView } from '../types'

const NOW = 1_000_000

function activity(
  overrides: Partial<LotteryActivityView> = {},
  me: Partial<LotteryActivityView['me']> = {}
): LotteryActivityView {
  return {
    id: 1,
    title: 'Spring wheel',
    description: '',
    mode: 'wheel',
    status: 'active',
    start_time: 0,
    end_time: 0,
    draw_time: 0,
    target_participants: 0,
    min_spend: 0,
    spend_start_time: 0,
    spend_end_time: 0,
    min_invites: 0,
    invite_start_time: 0,
    invite_end_time: 0,
    wheel_total_limit: 0,
    wheel_daily_limit: 0,
    entry_count: 0,
    drawn_at: 0,
    created_at: 0,
    updated_at: 0,
    prizes: [],
    ...overrides,
    winners: [],
    winner_count: 0,
    me: {
      paid: 0,
      invited: 0,
      eligible: true,
      joined: false,
      spins_used: 0,
      spins_used_today: 0,
      wins: [],
      ...me,
    },
  }
}

describe('getActivityAvailability', () => {
  it.each([
    {
      name: 'an open wheel with unlimited spins can be spun',
      input: activity(),
      action: 'spin',
      reason: null,
    },
    {
      name: 'a wheel before its start time is blocked as not started',
      input: activity({ start_time: NOW + 60 }),
      action: 'spin',
      reason: 'This activity has not started yet',
    },
    {
      name: 'a wheel after its end time is blocked as ended',
      input: activity({ end_time: NOW - 60 }),
      action: 'spin',
      reason: 'This activity has ended',
    },
    {
      name: 'a scheduled draw past its entry deadline waits for the draw',
      input: activity({ mode: 'scheduled', end_time: NOW - 60 }),
      action: 'join',
      reason: 'Entries are closed; waiting for the draw',
    },
    {
      name: 'a user below the spending requirement is blocked',
      input: activity({ min_spend: 10 }, { eligible: false, paid: 3 }),
      action: 'spin',
      reason: 'You do not meet the spending requirement of this activity',
    },
    {
      name: 'a user below the invitation requirement is blocked',
      input: activity(
        { min_spend: 10, min_invites: 3 },
        { eligible: false, paid: 10, invited: 1 }
      ),
      action: 'spin',
      reason: 'You do not meet the invitation requirement of this activity',
    },
    {
      name: 'a user below both requirements is told about spending first',
      input: activity(
        { min_spend: 10, min_invites: 3 },
        { eligible: false, paid: 3, invited: 1 }
      ),
      action: 'spin',
      reason: 'You do not meet the spending requirement of this activity',
    },
    {
      name: 'a user who used every spin is blocked',
      input: activity({ wheel_total_limit: 2 }, { spins_used: 2 }),
      action: 'spin',
      reason: 'You have used all your spins for this activity',
    },
    {
      name: 'a user who used today’s spins is blocked for today',
      input: activity(
        { wheel_total_limit: 5, wheel_daily_limit: 1 },
        { spins_used: 1, spins_used_today: 1 }
      ),
      action: 'spin',
      reason: 'You have used all your spins for today',
    },
    {
      name: 'a user who joined a draw cannot join again',
      input: activity({ mode: 'participants' }, { joined: true }),
      action: 'join',
      reason: 'You have joined this activity',
    },
    {
      name: 'a full participant draw waiting to be drawn refuses new entrants',
      input: activity({
        mode: 'participants',
        target_participants: 2,
        entry_count: 2,
      }),
      action: 'join',
      reason: 'This activity is full; waiting for the draw',
    },
    {
      name: 'a drawn activity offers no action',
      input: activity({ mode: 'scheduled', status: 'drawn' }),
      action: null,
      reason: null,
    },
  ])('$name', ({ input, action, reason }) => {
    const result = getActivityAvailability(input, NOW)
    expect(result.action).toBe(action)
    expect(result.blockedReason).toBe(reason)
  })

  it('counts remaining spins against both limits', () => {
    const result = getActivityAvailability(
      activity(
        { wheel_total_limit: 5, wheel_daily_limit: 2 },
        { spins_used: 3, spins_used_today: 1 }
      ),
      NOW
    )
    expect(result.spinsLeft).toBe(2)
    expect(result.spinsLeftToday).toBe(1)
  })
})

describe('isHistoryActivity', () => {
  it.each([
    { name: 'an open wheel', input: activity(), history: false },
    {
      name: 'a wheel past its end time',
      input: activity({ end_time: NOW - 1 }),
      history: true,
    },
    {
      name: 'a scheduled draw waiting for its draw',
      input: activity({ mode: 'scheduled', end_time: NOW - 1 }),
      history: false,
    },
    {
      name: 'a drawn activity',
      input: activity({ mode: 'participants', status: 'drawn' }),
      history: true,
    },
    {
      name: 'an upcoming wheel',
      input: activity({ start_time: NOW + 60 }),
      history: false,
    },
  ])('treats $name as history: $history', ({ input, history }) => {
    expect(isHistoryActivity(input, NOW)).toBe(history)
  })
})
