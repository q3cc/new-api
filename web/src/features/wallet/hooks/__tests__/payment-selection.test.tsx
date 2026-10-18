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

import { act, renderHook, waitFor } from '@testing-library/react'
import { expect, it, vi } from 'vitest'

import { api } from '@/lib/api'

import { dispatchSelectedPayment } from '../../lib/payment'
import { usePayment } from '../use-payment'
import { useTopupInfo } from '../use-topup-info'

it.each([undefined, false, 'false'])(
  'wallet loading preserves service selection and gateway mode for mapi=%s',
  async (mapi) => {
    vi.spyOn(api, 'get').mockResolvedValue({
      data: {
        success: true,
        data: {
          enable_online_topup: true,
          enable_stripe_topup: false,
          pay_methods: [
            { id: 'epay_b', name: 'Alipay B', type: 'alipay' },
            { id: 'epay_a', name: 'Alipay A', type: 'alipay', mapi },
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
    expect(regular).toHaveBeenCalledWith(2, 'epay_a', { mapi: false })
  }
)

it.each([
  { mapi: 'true', fails: false },
  { mapi: true, fails: false },
  { mapi: 'true', fails: true },
])(
  'a loaded mapi=$mapi method never opens a tab, including while pending (fails=$fails)',
  async ({ mapi, fails }) => {
    vi.spyOn(api, 'get').mockResolvedValue({
      data: {
        success: true,
        data: {
          enable_online_topup: true,
          pay_methods: [{ id: 'epay_wx', name: 'WeChat', type: 'wxpay', mapi }],
          min_topup: 1,
          amount_options: [10],
        },
      },
    })
    const payment = {
      trade_no: 'USR1NOabc',
      qrcode: 'weixin://wxpay/bizpayurl?pr=test',
      pay_url: 'https://pay.example.com/qr/1',
    }
    let resolveResponse: () => void = () => {}
    const responseReady = new Promise<void>((resolve) => {
      resolveResponse = resolve
    })
    const post = vi.spyOn(api, 'post').mockImplementation(async () => {
      await responseReady
      if (fails) throw new Error('Payment service unavailable')
      return { data: { message: 'success', data: payment } }
    })
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    const onEpayMapi = vi.fn()
    const { result } = renderHook(() => ({
      topup: useTopupInfo(),
      payment: usePayment({ onEpayMapi }),
    }))
    await waitFor(() => expect(result.current.topup.loading).toBe(false))
    const method = result.current.topup.topupInfo?.pay_methods[0]
    if (!method) throw new Error('Expected the configured payment method')

    await act(async () => {
      const pending = dispatchSelectedPayment(method, 10, null, {
        regular: result.current.payment.processPayment,
        waffo: async () => false,
        waffoPancake: async () => false,
      })
      // No blank tab may be reserved even before the server answers.
      const openedWhilePending = open.mock.calls.length
      resolveResponse()
      expect(await pending).toBe(!fails)
      expect(openedWhilePending).toBe(0)
    })

    expect(post).toHaveBeenCalledWith(
      '/api/user/pay',
      { amount: 10, payment_method: 'epay_wx' },
      { skipBusinessError: true }
    )
    expect(open).not.toHaveBeenCalled()
    if (fails) {
      expect(onEpayMapi).not.toHaveBeenCalled()
    } else {
      expect(onEpayMapi).toHaveBeenCalledWith({
        ...payment,
        url_scheme: undefined,
      })
    }
  }
)
