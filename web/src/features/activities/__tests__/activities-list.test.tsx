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
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'

import { ActivitiesList } from '../components/activities-list'
import type { LotteryActivityView } from '../types'

const clients: QueryClient[] = []

afterEach(() => {
  clients.splice(0).forEach((client) => client.clear())
})

function activity(
  id: number,
  title: string,
  overrides: Partial<LotteryActivityView> = {}
): LotteryActivityView {
  return {
    id,
    title,
    description: '',
    mode: 'participants',
    status: 'active',
    start_time: 0,
    end_time: 0,
    draw_time: 0,
    target_participants: 5,
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
      joined: false,
      spins_used: 0,
      spins_used_today: 0,
      wins: [],
    },
    ...overrides,
  }
}

function renderList(activities: LotteryActivityView[]) {
  vi.spyOn(api, 'get').mockResolvedValue({
    data: { success: true, data: activities },
  })
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  clients.push(client)
  render(
    <QueryClientProvider client={client}>
      <ActivitiesList />
    </QueryClientProvider>
  )
}

describe('ActivitiesList', () => {
  it('shows ongoing activities and keeps past ones collapsed until opened', async () => {
    renderList([
      activity(1, 'Launch party'),
      activity(2, 'Spring draw', { status: 'drawn', drawn_at: 1000 }),
    ])

    expect(await screen.findByText('Launch party')).toBeInTheDocument()
    const toggle = screen.getByRole('button', { name: 'Past activities (1)' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('Spring draw')).toBeNull()

    await userEvent.click(toggle)

    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('Spring draw')).toBeInTheDocument()
  })

  it('says there is nothing ongoing when every activity is past', async () => {
    renderList([activity(2, 'Spring draw', { status: 'drawn' })])

    expect(await screen.findByText('No ongoing activities')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Past activities (1)' })
    ).toBeInTheDocument()
  })

  it('refreshes every minute while an activity is running', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      renderList([activity(1, 'Launch party')])
      expect(await screen.findByText('Launch party')).toBeInTheDocument()
      expect(api.get).toHaveBeenCalledTimes(1)

      await vi.advanceTimersByTimeAsync(59_000)
      expect(api.get).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(1_000)
      expect(api.get).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('stops refreshing once every activity is past', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      renderList([activity(2, 'Spring draw', { status: 'drawn' })])
      expect(
        await screen.findByText('No ongoing activities')
      ).toBeInTheDocument()

      await vi.advanceTimersByTimeAsync(120_000)
      expect(api.get).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('hides the past section when nothing has ended', async () => {
    renderList([activity(1, 'Launch party')])

    expect(await screen.findByText('Launch party')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Past activities/ })).toBeNull()
  })
})
