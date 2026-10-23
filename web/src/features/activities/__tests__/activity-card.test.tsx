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
    rules: '',
    mode: 'participants',
    status: 'active',
    start_time: 0,
    end_time: 0,
    draw_time: 0,
    target_participants: 10,
    min_spend: 20,
    spend_start_time: 0,
    spend_end_time: 0,
    min_invites: 0,
    invite_start_time: 0,
    invite_end_time: 0,
    rank_metric: '',
    rank_min_value: 0,
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
      invited: 0,
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

  it('shows invitation progress and names the missing invitations when spending is met', () => {
    renderCard({
      ...participantDraw({ eligible: false, paid: 25, invited: 1 }),
      min_invites: 3,
    })

    expect(screen.getByRole('button', { name: 'Join' })).toBeDisabled()
    expect(screen.getByText('Invited 1 / 3')).toBeInTheDocument()
    expect(screen.getByText('You paid 25 of 20')).toHaveClass('text-success')
    expect(screen.getByText('Invited 1 / 3')).toHaveClass('text-warning')
    expect(
      screen.getByText(
        'You do not meet the invitation requirement of this activity'
      )
    ).toBeInTheDocument()
  })

  it('shows no invitation progress for activities without an invitation requirement', () => {
    renderCard(participantDraw())

    expect(screen.queryByText(/^Invited /)).not.toBeInTheDocument()
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

  it('tells entrants a cancelled activity was cancelled instead of offering to join', () => {
    renderCard({
      ...participantDraw({ eligible: true, joined: true }),
      status: 'cancelled',
    })

    expect(screen.getByText('This activity was cancelled')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Joined' })).toBeNull()
    expect(screen.queryByText('Current chance to win')).toBeNull()
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
            rank: 0,
            score: 0,
            disqualified: false,
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

function leaderboard(
  overrides: Partial<LotteryActivityView> = {},
  board: Partial<NonNullable<LotteryActivityView['leaderboard']>> = {}
): LotteryActivityView {
  const base = participantDraw({ eligible: true })
  const prize = base.prizes[0]
  return {
    ...base,
    mode: 'leaderboard',
    status: 'active',
    start_time: NOW - 100,
    end_time: NOW + 1000,
    min_spend: 0,
    rank_metric: 'recharge',
    rank_min_value: 10,
    prizes: [
      { ...prize, id: 11, name: 'Gold', quantity: 1 },
      { ...prize, id: 12, name: 'Silver', quantity: 2 },
    ],
    leaderboard: {
      rows: [
        { user_id: 7, display_name: 'Alice', rank: 1, score: 50 },
        { user_id: 9, display_name: '', rank: 2, score: 30 },
      ],
      ranked: 2,
      final: false,
      me: { rank: 0, score: 4, excluded: false },
      ...board,
    },
    ...overrides,
  }
}

describe('ActivityCard rules', () => {
  it('opens the Markdown rules from the Activity rules button', async () => {
    const user = userEvent.setup()
    renderCard({
      ...participantDraw(),
      rules: '## How to take part\n- Pay **20** to join',
    })

    await user.click(screen.getByRole('button', { name: 'Activity rules' }))
    const dialog = await screen.findByRole('dialog')
    expect(
      within(dialog).getByRole('heading', { name: 'How to take part' })
    ).toBeInTheDocument()
    expect(within(dialog).getByText('20').tagName).toBe('STRONG')
  })

  it('offers no rules button when there are no rules', () => {
    renderCard(participantDraw())

    expect(screen.queryByRole('button', { name: 'Activity rules' })).toBeNull()
  })
})

describe('ActivityCard leaderboard', () => {
  it('lists the ranks each prize covers and how far an unranked viewer is from the threshold', () => {
    renderCard(leaderboard())

    expect(screen.getByText('Ranked by Recharge')).toBeInTheDocument()
    expect(screen.getByText('At least 10 to be ranked')).toBeInTheDocument()
    const prizes = screen.getByRole('list', { name: 'Prizes' })
    expect(within(prizes).getByText('Rank 1')).toBeInTheDocument()
    expect(within(prizes).getByText('Ranks 2–3')).toBeInTheDocument()
    expect(screen.getByText('Alice')).toBeInTheDocument()
    expect(screen.queryByText('#7')).toBeNull()
    expect(screen.getByText('#9')).toBeInTheDocument()
    expect(screen.getByText('Not ranked')).toBeInTheDocument()
    expect(screen.getByText('6 more to be ranked')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Join' })).toBeNull()
  })

  it('marks the viewer on a locked board waiting for the awards', () => {
    renderCard(
      leaderboard(
        { status: 'ranked', end_time: NOW - 10 },
        { final: true, me: { rank: 2, score: 30, excluded: false } }
      )
    )

    const myRow = screen.getByText('#9').closest('tr')
    if (!myRow) throw new Error('The viewer must be listed in a row')
    expect(myRow).toHaveAttribute('aria-current', 'true')
    expect(within(myRow).getByText('You')).toBeInTheDocument()
    expect(screen.getByText('Alice').closest('tr')).not.toHaveAttribute(
      'aria-current'
    )
    expect(
      screen.getByText('Ranks are locked; waiting for the awards')
    ).toBeInTheDocument()
    expect(screen.getByText('Final ranks of 2 users')).toBeInTheDocument()
    expect(screen.queryByText(/more to be ranked/)).toBeNull()
  })

  it('tells administrators they are not ranked', () => {
    renderCard(leaderboard({}, { me: { rank: 0, score: 0, excluded: true } }))

    expect(
      screen.getByText('Administrators and disabled accounts are not ranked')
    ).toBeInTheDocument()
    expect(screen.queryByText(/more to be ranked/)).toBeNull()
  })
})
