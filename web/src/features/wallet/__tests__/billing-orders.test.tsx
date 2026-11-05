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
import { toast } from 'sonner'
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
function history(items: object[] = [subscription]) {
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

const epayTopup = {
  id: 3,
  user_id: 20,
  trade_no: 'USR20NOlate',
  order_type: 'topup',
  amount: 10,
  money: 7,
  status: 'expired',
  awaiting_payment: true,
  payment_provider: 'epay',
  create_time: 1,
  payment_method: 'alipay',
}

it('offers the payment check only on the reader’s own epay orders still awaiting payment', async () => {
  useAuthStore.getState().auth.setUser({ id: 20, username: 'payer', role: 1 })
  history([
    epayTopup,
    {
      ...epayTopup,
      id: 4,
      trade_no: 'USR20NOstripe',
      payment_provider: 'stripe',
    },
    { ...epayTopup, id: 5, trade_no: 'USR20NOclosed', awaiting_payment: false },
  ])
  render(<BillingHistoryDialog open onOpenChange={vi.fn()} />)

  expect(await screen.findByText('USR20NOlate')).toBeVisible()
  expect(screen.getAllByText('Expired')).toHaveLength(3)
  expect(screen.getAllByRole('button', { name: 'I have paid' })).toHaveLength(1)
})

it('settles a paid order from the history, confirms it and reloads the list', async () => {
  useAuthStore.getState().auth.setUser({ id: 20, username: 'payer', role: 1 })
  history([epayTopup])
  const post = vi.spyOn(api, 'post').mockResolvedValue({
    data: {
      success: true,
      data: { trade_no: 'USR20NOlate', status: 'success' },
    },
  })
  const success = vi.spyOn(toast, 'success')
  const onPaid = vi.fn()
  render(<BillingHistoryDialog open onOpenChange={vi.fn()} onPaid={onPaid} />)

  await userEvent.click(
    await screen.findByRole('button', { name: 'I have paid' })
  )

  await waitFor(() =>
    expect(success).toHaveBeenCalledWith(
      'Payment received. Your balance has been updated.'
    )
  )
  expect(post).toHaveBeenCalledWith(
    '/api/user/topup/query',
    { trade_no: 'USR20NOlate' },
    { skipBusinessError: true }
  )
  expect(onPaid).toHaveBeenCalledOnce()
  await waitFor(() => expect(api.get).toHaveBeenCalledTimes(2))
})

it('lets an admin complete an expired order', async () => {
  useAuthStore.getState().auth.setUser({ id: 1, username: 'root', role: 100 })
  history([epayTopup])
  render(<BillingHistoryDialog open onOpenChange={vi.fn()} />)

  expect(
    await screen.findByRole('button', { name: 'Complete Order' })
  ).toBeVisible()
  expect(
    screen.queryByRole('button', { name: 'I have paid' })
  ).not.toBeInTheDocument()
})
