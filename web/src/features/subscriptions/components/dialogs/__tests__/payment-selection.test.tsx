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
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'

import { api } from '@/lib/api'

import { SubscriptionPurchaseDialog } from '../subscription-purchase-dialog'

it('subscription payment submits the selected Alipay service rather than its shared gateway type', async () => {
  const post = vi.spyOn(api, 'post').mockResolvedValue({
    data: {
      success: true,
      message: 'success',
      url: 'https://payment.example.com',
      data: {},
    },
  })
  vi.spyOn(HTMLFormElement.prototype, 'submit').mockImplementation(() => {})
  render(
    <QueryClientProvider client={new QueryClient()}>
      <SubscriptionPurchaseDialog
        open
        onOpenChange={vi.fn()}
        enableOnlineTopUp
        epayMethods={[
          { id: 'epay_a', name: 'Alipay A', type: 'alipay' },
          { id: 'epay_b', name: 'Alipay B', type: 'alipay' },
        ]}
        plan={{
          plan: {
            id: 7,
            title: 'Monthly API',
            enabled: true,
            currency: 'USD',
            price_amount: 10,
            duration_unit: 'month',
            duration_value: 1,
            quota_reset_period: 'monthly',
            sort_order: 0,
            max_purchase_per_user: 0,
            total_amount: 5000000,
            allow_balance_pay: false,
            allow_wallet_overflow: true,
          },
        }}
      />
    </QueryClientProvider>
  )
  const user = userEvent.setup()
  await user.click(screen.getByRole('combobox'))
  await user.click(await screen.findByRole('option', { name: 'Alipay B' }))
  await user.click(screen.getByRole('button', { name: /^Pay$/ }))
  await waitFor(() =>
    expect(post).toHaveBeenCalledWith('/api/subscription/epay/pay', {
      plan_id: 7,
      payment_method: 'epay_b',
    })
  )
})
