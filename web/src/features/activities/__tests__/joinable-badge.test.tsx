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
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'

import { useHasJoinableActivity } from '../hooks/use-has-joinable-activity'
import type { LotteryActivityView } from '../types'

afterEach(() => vi.restoreAllMocks())

function activity(me: Partial<LotteryActivityView['me']>): LotteryActivityView {
  return {
    id: 1,
    title: 'Spring wheel',
    description: '',
    rules: '',
    mode: 'wheel',
    status: 'active',
    start_time: 0,
    end_time: 0,
    draw_time: 0,
    target_participants: 0,
    min_spend: 10,
    spend_start_time: 0,
    spend_end_time: 0,
    min_invites: 0,
    invite_start_time: 0,
    invite_end_time: 0,
    rank_metric: '',
    rank_min_value: 0,
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

function render(enabled: boolean) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const wrapper = (props: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{props.children}</QueryClientProvider>
  )
  return renderHook(() => useHasJoinableActivity(enabled), { wrapper })
}

function serve(activities: LotteryActivityView[]) {
  return vi
    .spyOn(api, 'get')
    .mockResolvedValue({ data: { success: true, data: activities } })
}

it('reports an activity the user can take part in', async () => {
  serve([activity({ eligible: false, paid: 5 }), activity({ paid: 10 })])

  const { result } = render(true)

  await waitFor(() => expect(result.current).toBe(true))
})

it('reports nothing when the user meets no activity requirement', async () => {
  const get = serve([activity({ eligible: false, paid: 5 })])

  const { result } = render(true)

  await waitFor(() => expect(get).toHaveBeenCalled())
  expect(result.current).toBe(false)
})

it('does not load activities while the sidebar entry is hidden', () => {
  const get = serve([activity({ paid: 10 })])

  const { result } = render(false)

  expect(get).not.toHaveBeenCalled()
  expect(result.current).toBe(false)
})
