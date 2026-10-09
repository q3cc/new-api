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
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'
import { useAuthStore } from '@/stores/auth-store'

import { BillingHistoryDialog } from '../components/dialogs/billing-history-dialog'

afterEach(() => useAuthStore.getState().auth.reset())
const subscription = {
  id: 1,
  user_id: 20,
  trade_no: 'subscription-pending',
  order_type: 'subscription',
  plan_id: 8,
  plan_title: 'Monthly Plan',
  amount: 0,
  money: 9.99,
  status: 'pending',
  create_time: 1,
  payment_method: 'alipay',
}
function history(items = [subscription]) {
  vi.spyOn(api, 'get').mockResolvedValue({
    data: { success: true, data: { items, total: items.length } },
  })
}

it('pending subscription orders remain visible after reopening history and have no completion action for ordinary users', async () => {
  history()
  const view = render(<BillingHistoryDialog open onOpenChange={vi.fn()} />)
  expect(await screen.findByText('Monthly Plan')).toBeVisible()
  expect(screen.getByText('Pending')).toBeVisible()
  expect(
    screen.queryByRole('button', { name: 'Complete Order' })
  ).not.toBeInTheDocument()
  view.unmount()
  render(<BillingHistoryDialog open onOpenChange={vi.fn()} />)
  expect(await screen.findByText('subscription-pending')).toBeVisible()
  expect(screen.getByText('Monthly Plan')).toBeVisible()
})

it('admin subscription completion confirms plan activation and submits the order number only', async () => {
  useAuthStore.getState().auth.setUser({ id: 1, username: 'root', role: 100 })
  history()
  const post = vi
    .spyOn(api, 'post')
    .mockResolvedValue({ data: { success: true } })
  render(<BillingHistoryDialog open onOpenChange={vi.fn()} />)
  await userEvent.click(
    await screen.findByRole('button', { name: 'Complete Order' })
  )
  const confirmation = screen.getByRole('alertdialog')
  expect(
    within(confirmation).getByText(
      'Complete this order and activate the subscription plan for the user?'
    )
  ).toBeVisible()
  await userEvent.click(
    within(confirmation).getByRole('button', { name: 'Confirm' })
  )
  await waitFor(() =>
    expect(post).toHaveBeenCalledWith('/api/user/topup/complete', {
      trade_no: 'subscription-pending',
    })
  )
})

it('failed and expired subscription orders show their retained status and plan', async () => {
  history([
    { ...subscription, status: 'failed' },
    {
      ...subscription,
      id: 2,
      trade_no: 'subscription-expired',
      status: 'expired',
    },
  ])
  render(<BillingHistoryDialog open onOpenChange={vi.fn()} />)
  expect(await screen.findByText('Failed')).toBeVisible()
  expect(screen.getByText('Expired')).toBeVisible()
  expect(screen.getAllByText('Monthly Plan')).toHaveLength(2)
})
