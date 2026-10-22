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
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { useAuthStore } from '@/stores/auth-store'

import { ActivityCard } from '../components/activity-card'
import type { LotteryActivityView } from '../types'

const NOW = 1_000_000

function participantDraw(
  me: Partial<LotteryActivityView['me']> = {}
): LotteryActivityView {
  return {
    id: 4,
    title: 'Launch party',
    description: 'Ten seats',
    mode: 'participants',
    status: 'active',
    start_time: 0,
    end_time: 0,
    draw_time: 0,
    target_participants: 10,
    min_spend: 20,
    spend_start_time: 0,
    spend_end_time: 0,
    wheel_total_limit: 0,
    wheel_daily_limit: 0,
    entry_count: 3,
    drawn_at: 0,
    created_at: 0,
    updated_at: 0,
    prizes: [
      {
        id: 1,
        activity_id: 4,
        name: 'Mug',
        type: 'manual',
        quota: 0,
        plan_id: 0,
        quantity: 2,
        awarded: 0,
        probability: 0,
        sort_order: 0,
      },
    ],
    winners: [],
    winner_count: 0,
    me: {
      paid: 5,
      eligible: false,
      joined: false,
      spins_used: 0,
      spins_used_today: 0,
      wins: [],
      ...me,
    },
  }
}

function renderCard(activity: LotteryActivityView, onJoin = vi.fn()) {
  render(
    <ActivityCard
      activity={activity}
      nowSeconds={NOW}
      joining={false}
      onJoin={onJoin}
      onSpin={vi.fn()}
      onSpinSettled={vi.fn()}
    />
  )
  return onJoin
}

describe('ActivityCard', () => {
  it('blocks joining and shows spending progress below the requirement', () => {
    renderCard(participantDraw())

    expect(screen.getByRole('button', { name: 'Join' })).toBeDisabled()
    expect(screen.getByText('You paid 5 of 20')).toBeInTheDocument()
    expect(
      screen.getByText(
        'You do not meet the spending requirement of this activity'
      )
    ).toBeInTheDocument()
    expect(
      screen.getByText('3 / 10 joined, draws when full')
    ).toBeInTheDocument()
  })

  it('lets an eligible user join', async () => {
    const activity = participantDraw({ eligible: true, paid: 25 })
    const onJoin = renderCard(activity)

    await userEvent.click(screen.getByRole('button', { name: 'Join' }))

    expect(onJoin).toHaveBeenCalledWith(activity)
  })

  it('shows the live chance of an open draw counting the user as an entrant', () => {
    renderCard(participantDraw({ eligible: true }))

    // 2 winners among 3 entrants plus the user.
    expect(screen.getByText('50%')).toBeInTheDocument()
    expect(
      screen.getByText('Based on 4 entrants if you join')
    ).toBeInTheDocument()
    expect(screen.getByText('Live 50%')).toBeInTheDocument()
  })

  it('lists winners by user ID and marks the current user', () => {
    useAuthStore.getState().auth.setUser({ id: 2, username: 'me', role: 1 })
    renderCard({
      ...participantDraw({ eligible: true, joined: true }),
      status: 'drawn',
      winners: [
        { user_id: 7, prize_id: 1, prize_name: 'Mug', created_at: 100 },
        { user_id: 2, prize_id: 1, prize_name: 'Mug', created_at: 90 },
      ],
      winner_count: 2,
    })

    const list = screen.getByRole('region', { name: 'Winners list' })
    expect(within(list).getByText('#7')).toBeInTheDocument()
    expect(within(list).getByText('Me')).toBeInTheDocument()
    expect(within(list).getByText('Winners (2)')).toBeInTheDocument()
    expect(screen.queryByText('Current chance to win')).toBeNull()
    useAuthStore.getState().auth.reset()
  })

  it('shows the result of a drawn activity the user joined', () => {
    renderCard({
      ...participantDraw({
        eligible: true,
        joined: true,
        wins: [
          {
            id: 9,
            activity_id: 4,
            user_id: 2,
            spin_date: '',
            prize_id: 1,
            prize_name: 'Mug',
            prize_type: 'manual',
            delivery_status: 'pending',
            delivery_note: '',
            delivered_at: 0,
            created_at: 0,
          },
        ],
      }),
      status: 'drawn',
    })

    expect(screen.getByText('You won Mug')).toBeInTheDocument()
    expect(screen.getByText('Pending delivery')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Join' })).toBeNull()
  })
})
