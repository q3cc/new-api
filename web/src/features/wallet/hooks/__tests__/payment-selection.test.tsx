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

import { renderHook, waitFor } from '@testing-library/react'
import { expect, it, vi } from 'vitest'

import { api } from '@/lib/api'

import { dispatchSelectedPayment } from '../../lib/payment'
import { useTopupInfo } from '../use-topup-info'

it('wallet loading preserves server order and separately selects two Alipay services', async () => {
  vi.spyOn(api, 'get').mockResolvedValue({
    data: {
      success: true,
      data: {
        enable_online_topup: true,
        enable_stripe_topup: false,
        pay_methods: [
          { id: 'epay_b', name: 'Alipay B', type: 'alipay' },
          { id: 'epay_a', name: 'Alipay A', type: 'alipay' },
        ],
        min_topup: 1,
        stripe_min_topup: 1,
        amount_options: [2],
        discount: {},
      },
    },
  })
  const { result } = renderHook(() => useTopupInfo())
  await waitFor(() => expect(result.current.loading).toBe(false))
  const methods = result.current.topupInfo?.pay_methods ?? []
  expect(methods.map((m) => m.id)).toEqual(['epay_b', 'epay_a'])
  const regular = vi.fn(async () => true)
  await dispatchSelectedPayment(methods[1], 2, null, {
    regular,
    waffo: async () => false,
    waffoPancake: async () => false,
  })
  expect(regular).toHaveBeenCalledWith(2, 'epay_a')
})
