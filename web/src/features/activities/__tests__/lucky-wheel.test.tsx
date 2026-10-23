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
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { LuckyWheel } from '../components/lucky-wheel'
import type { LotteryEntry, LotteryPrize } from '../types'

const prizes: LotteryPrize[] = [
  {
    id: 7,
    activity_id: 1,
    name: 'Credit',
    type: 'quota',
    quota: 500,
    plan_id: 0,
    quantity: 0,
    awarded: 0,
    probability: 5000,
    sort_order: 0,
  },
]

const winningEntry: LotteryEntry = {
  id: 3,
  activity_id: 1,
  user_id: 2,
  spin_date: '2026-10-22',
  prize_id: 7,
  prize_name: 'Credit',
  prize_type: 'quota',
  delivery_status: 'delivered',
  delivery_note: '',
  delivered_at: 0,
  rank: 0,
  score: 0,
  disqualified: false,
  created_at: 0,
}

describe('LuckyWheel', () => {
  it('reports the server result once the wheel stops', async () => {
    const onSpin = vi.fn(async () => winningEntry)
    const onSettled = vi.fn()
    render(
      <LuckyWheel
        prizes={prizes}
        disabled={false}
        onSpin={onSpin}
        onSettled={onSettled}
      />
    )

    expect(
      screen.getByRole('img', { name: 'Prize wheel with 2 segments' })
    ).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Spin' }))

    await waitFor(() => expect(onSettled).toHaveBeenCalledWith(winningEntry))
    expect(onSpin).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: 'Spin' })).toBeEnabled()
  })

  it('stays idle when the spin request fails', async () => {
    const onSettled = vi.fn()
    render(
      <LuckyWheel
        prizes={prizes}
        disabled={false}
        onSpin={async () => null}
        onSettled={onSettled}
      />
    )

    await userEvent.click(screen.getByRole('button', { name: 'Spin' }))

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Spin' })).toBeEnabled()
    )
    expect(onSettled).not.toHaveBeenCalled()
  })

  it('disables spinning when the user cannot spin', () => {
    render(
      <LuckyWheel
        prizes={prizes}
        disabled
        onSpin={vi.fn()}
        onSettled={vi.fn()}
      />
    )
    expect(screen.getByRole('button', { name: 'Spin' })).toBeDisabled()
  })
})
