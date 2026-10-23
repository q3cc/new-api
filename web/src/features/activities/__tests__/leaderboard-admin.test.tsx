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
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'

import { ActivityEntriesDialog } from '../components/admin/activity-entries-dialog'
import type { LotteryActivity, LotteryAdminEntry } from '../types'

const activity = {
  id: 5,
  title: 'Recharge board',
  mode: 'leaderboard',
  status: 'ranked',
  rank_metric: 'recharge',
  rank_min_value: 0,
  prizes: [],
} as unknown as LotteryActivity

function entry(
  id: number,
  rank: number,
  overrides: Partial<LotteryAdminEntry> = {}
): LotteryAdminEntry {
  return {
    id,
    activity_id: 5,
    user_id: 100 + rank,
    username: `user${rank}`,
    spin_date: '',
    prize_id: 0,
    prize_name: '',
    prize_type: '',
    delivery_status: 'none',
    delivery_note: '',
    delivered_at: 0,
    created_at: 0,
    rank,
    score: 50 - rank,
    disqualified: false,
    ...overrides,
  }
}

const onOpenChange = vi.fn()

beforeEach(() => {
  vi.spyOn(api, 'get').mockResolvedValue({
    data: {
      success: true,
      data: {
        page: 1,
        page_size: 20,
        total: 2,
        items: [
          entry(31, 1, { predicted_prize: 'Gold' }),
          entry(32, 2, { disqualified: true }),
        ],
      },
    },
  })
  vi.spyOn(api, 'post').mockResolvedValue({ data: { success: true } })
})

afterEach(() => {
  onOpenChange.mockReset()
  vi.restoreAllMocks()
})

function renderDialog() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  render(
    <QueryClientProvider client={client}>
      <ActivityEntriesDialog activity={activity} onOpenChange={onOpenChange} />
    </QueryClientProvider>
  )
}

it('shows locked ranks with their expected prizes and disqualifies a winner', async () => {
  const user = userEvent.setup()
  renderDialog()

  const winnerRow = (await screen.findByText('user1')).closest('tr')
  if (!winnerRow) throw new Error('The winner must be listed in a row')
  expect(within(winnerRow).getByText('Gold (expected)')).toBeInTheDocument()
  const disqualifiedRow = screen.getByText('user2').closest('tr')
  if (!disqualifiedRow) throw new Error('The entry must be listed in a row')
  expect(within(disqualifiedRow).getByText('Disqualified')).toBeInTheDocument()

  await user.click(
    within(winnerRow).getByRole('button', { name: 'Disqualify' })
  )
  await waitFor(() =>
    expect(api.post).toHaveBeenCalledWith(
      '/api/lottery/admin/entries/31/disqualify',
      { disqualified: true }
    )
  )
  await user.click(
    within(disqualifiedRow).getByRole('button', { name: 'Reinstate' })
  )
  await waitFor(() =>
    expect(api.post).toHaveBeenCalledWith(
      '/api/lottery/admin/entries/32/disqualify',
      { disqualified: false }
    )
  )
})

it('awards the prizes only after confirmation', async () => {
  const user = userEvent.setup()
  renderDialog()
  await screen.findByText('user1')

  await user.click(screen.getByRole('button', { name: 'Award prizes' }))
  const confirm = await screen.findByRole('alertdialog')
  expect(api.post).not.toHaveBeenCalled()
  await user.click(within(confirm).getByRole('button', { name: 'Continue' }))

  await waitFor(() =>
    expect(api.post).toHaveBeenCalledWith(
      '/api/lottery/admin/activities/5/draw'
    )
  )
  await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
})
