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

import { MyPrizes } from '../components/my-prizes'
import type { LotteryWin } from '../types'

function win(overrides: Partial<LotteryWin>): LotteryWin {
  return {
    id: 7,
    activity_id: 3,
    user_id: 1,
    spin_date: '',
    prize_id: 9,
    prize_name: 'Mug',
    prize_type: 'manual',
    delivery_status: 'pending',
    delivery_note: '',
    delivered_at: 0,
    winner_info: [],
    winner_info_at: 0,
    created_at: 1_700_000_000,
    rank: 0,
    score: 0,
    disqualified: false,
    activity_title: 'Gift',
    winner_notice: 'Shipped within a week',
    winner_fields: [
      { label: 'Address', required: true },
      { label: 'Remark', required: false },
    ],
    ...overrides,
  }
}

function renderPrizes(wins: LotteryWin[]) {
  vi.spyOn(api, 'get').mockResolvedValue({
    data: { success: true, data: wins },
  })
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  render(
    <QueryClientProvider client={client}>
      <MyPrizes />
    </QueryClientProvider>
  )
}

beforeEach(() => {
  vi.spyOn(api, 'put').mockResolvedValue({ data: { success: true } })
})

afterEach(() => {
  vi.restoreAllMocks()
})

it('a winner fills in what the activity asks for, required fields first', async () => {
  renderPrizes([win({})])
  await userEvent.click(
    await screen.findByRole('button', { name: 'Fill in information' })
  )
  const dialog = await screen.findByRole('dialog')
  expect(within(dialog).getByText('Shipped within a week')).toBeVisible()
  const save = within(dialog).getByRole('button', { name: 'Save' })
  expect(save).toBeDisabled()
  await userEvent.type(within(dialog).getByLabelText(/Address/), '1 Road')
  await userEvent.click(save)
  await waitFor(() =>
    expect(api.put).toHaveBeenCalledExactlyOnceWith(
      '/api/lottery/wins/7/info',
      { values: ['1 Road', ''] }
    )
  )
})

it('saved answers are offered for editing until a manual prize is delivered', async () => {
  const answered = [
    { label: 'Address', value: '2 Road' },
    { label: 'Remark', value: '' },
  ]
  renderPrizes([
    win({ winner_info: answered }),
    win({ id: 8, winner_info: answered, delivery_status: 'delivered' }),
    win({ id: 9, winner_fields: [] }),
    win({ id: 10, prize_type: 'quota', delivery_status: 'delivered' }),
  ])
  await userEvent.click(
    await screen.findByRole('button', { name: 'Edit information' })
  )
  expect(
    within(await screen.findByRole('dialog')).getByLabelText(/Address/)
  ).toHaveValue('2 Road')
  expect(screen.getAllByText('Filled in')).toHaveLength(1)
  expect(
    screen.queryByRole('button', { name: 'Fill in information' })
  ).not.toBeInTheDocument()
})
