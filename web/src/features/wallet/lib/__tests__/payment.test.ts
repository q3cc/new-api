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
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import { PAYMENT_TYPES } from '../../constants'
import {
  dispatchSelectedPayment,
  getInAppPaymentLink,
  isStripePayment,
  isWaffoPayment,
  isWaffoPancakePayment,
  openPaymentWindow,
} from '../payment'

describe('payment type classification', () => {
  test('keeps Waffo and Waffo Pancake on their dedicated flows', () => {
    expect(isWaffoPayment(PAYMENT_TYPES.WAFFO)).toBe(true)
    expect(isWaffoPayment(PAYMENT_TYPES.WAFFO_PANCAKE)).toBe(false)
    expect(isWaffoPancakePayment(PAYMENT_TYPES.WAFFO_PANCAKE)).toBe(true)
    expect(isWaffoPancakePayment(PAYMENT_TYPES.WAFFO)).toBe(false)
    expect(isStripePayment(PAYMENT_TYPES.STRIPE)).toBe(true)
  })
})

describe('payment dispatch', () => {
  test('keeps the selected Waffo method index through confirmation', async () => {
    const calls: string[] = []
    const success = await dispatchSelectedPayment(
      { name: 'Waffo Card', type: PAYMENT_TYPES.WAFFO },
      120,
      3,
      {
        regular: async () => {
          calls.push('regular')
          return false
        },
        waffo: async (amount, index) => {
          calls.push(`waffo:${amount}:${index}`)
          return true
        },
        waffoPancake: async () => {
          calls.push('pancake')
          return false
        },
      }
    )

    expect(success).toBe(true)
    expect(calls).toEqual(['waffo:120:3'])
  })

  test('does not create a Waffo order without a selected method index', async () => {
    let called = false
    const success = await dispatchSelectedPayment(
      { name: 'Waffo Card', type: PAYMENT_TYPES.WAFFO },
      120,
      null,
      {
        regular: async () => false,
        waffo: async () => {
          called = true
          return true
        },
        waffoPancake: async () => false,
      }
    )

    expect(success).toBe(false)
    expect(called).toBe(false)
  })
})

test('same gateway type dispatches the selected service identity rather than the ambiguous type', async () => {
  const calls: string[] = []
  for (const id of ['epay_a', 'epay_b']) {
    await dispatchSelectedPayment(
      { name: 'Alipay', type: 'alipay', id },
      2,
      null,
      {
        regular: async (_amount, key) => {
          calls.push(key)
          return true
        },
        waffo: async () => false,
        waffoPancake: async () => false,
      }
    )
  }
  expect(calls).toEqual(['epay_a', 'epay_b'])
})

describe('reserved payment window', () => {
  let popup: {
    closed: boolean
    opener: unknown
    location: { replace: (url: string) => void; replaced: string }
    close: () => void
  }
  let open: ReturnType<typeof vi.spyOn>

  /** Capture the form at submission time, before the caller removes it. */
  function captureSubmission() {
    const submitted: {
      action: string
      method: string
      target: string
      fields: [string, string][]
    }[] = []
    vi.spyOn(HTMLFormElement.prototype, 'submit').mockImplementation(function (
      this: HTMLFormElement
    ) {
      submitted.push({
        action: this.getAttribute('action') ?? '',
        method: this.method,
        target: this.target,
        fields: [...this.querySelectorAll('input')].map((input) => [
          input.name,
          input.value,
        ]),
      })
    })
    return submitted
  }

  beforeEach(() => {
    popup = {
      closed: false,
      opener: window,
      location: {
        replaced: '',
        replace(url: string) {
          this.replaced = url
        },
      },
      close: vi.fn(),
    }
    open = vi.spyOn(window, 'open').mockReturnValue(popup as unknown as Window)
  })
  afterEach(() => {
    vi.restoreAllMocks()
    document.querySelectorAll('form').forEach((form) => form.remove())
  })

  test('reserves a uniquely named tab and detaches its opener', () => {
    openPaymentWindow()
    const firstName = open.mock.calls[0]?.[1]
    openPaymentWindow()
    const secondName = open.mock.calls[1]?.[1]

    // Opening up front, while the click's user activation is still live, is what
    // keeps the submission out of the popup blocker's way.
    expect(open).toHaveBeenCalledTimes(2)
    expect(firstName).not.toBe(secondName)
    // The gateway page must not be able to drive the dashboard through opener.
    expect(popup.opener).toBeNull()
  })

  test('posts the gateway form into the reserved tab with every parameter', () => {
    const submitted = captureSubmission()

    const started = openPaymentWindow().submit(
      'https://pay.example.com/submit',
      { pid: '1001', money: '7.00', device: 'pc' }
    )

    expect(started).toBe(true)
    expect(submitted).toEqual([
      {
        action: 'https://pay.example.com/submit',
        method: 'post',
        // The reserved tab already exists, so this opens no new window.
        target: open.mock.calls[0]?.[1],
        fields: [
          ['pid', '1001'],
          ['money', '7.00'],
          ['device', 'pc'],
        ],
      },
    ])
    // The form must not linger in the page after it has been submitted.
    expect(document.querySelector('form')).toBeNull()
  })

  test('reports failure instead of replacing this tab when no tab was reserved', () => {
    open.mockReturnValue(null)
    const submitted = captureSubmission()

    const started = openPaymentWindow().submit(
      'https://pay.example.com/submit',
      { pid: '1' }
    )

    // Replacing the dashboard with a gateway page is what produced the blank
    // page, so a blocked reservation reports failure to the caller instead.
    expect(started).toBe(false)
    expect(submitted).toHaveLength(0)
  })

  test('reports failure when the reserved tab was closed before the order resolved', () => {
    const submitted = captureSubmission()
    const paymentWindow = openPaymentWindow()
    popup.closed = true

    expect(
      paymentWindow.submit('https://pay.example.com/submit', { pid: '1' })
    ).toBe(false)
    expect(submitted).toHaveLength(0)
  })

  test('navigates the reserved tab with replace, and reports a closed tab', () => {
    const reserved = openPaymentWindow()
    expect(reserved.navigate('https://pay.example.com/checkout')).toBe(true)
    expect(popup.location.replaced).toBe('https://pay.example.com/checkout')

    open.mockReturnValue(null)
    expect(openPaymentWindow().navigate('https://pay.example.com/x')).toBe(
      false
    )

    const closed = openPaymentWindow()
    popup.closed = true
    expect(closed.navigate('https://pay.example.com/x')).toBe(false)
  })

  test('closes an unused reservation but leaves a driven tab alone', () => {
    const unused = openPaymentWindow()
    unused.closeIfUnused()
    expect(popup.close).toHaveBeenCalledTimes(1)

    const driven = openPaymentWindow()
    driven.navigate('https://pay.example.com/checkout')
    driven.closeIfUnused()
    // A tab already showing the gateway is the payment page itself.
    expect(popup.close).toHaveBeenCalledTimes(1)

    open.mockReturnValue(null)
    expect(() => openPaymentWindow().closeIfUnused()).not.toThrow()
  })
})

describe('in-app payment link generation', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  test('rejects mismatched paymentType and protocol in desktop browser', () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Chrome/130')
    // Alipay paymentType should not accept weixin:// protocol
    expect(
      getInAppPaymentLink(
        { trade_no: '1', qrcode: 'weixin://wxpay/bizpayurl?pr=test' },
        PAYMENT_TYPES.ALIPAY
      )
    ).toBeUndefined()
    // WeChat paymentType should not accept alipays:// protocol
    expect(
      getInAppPaymentLink(
        { trade_no: '1', qrcode: 'alipays://platformapi/startapp?appId=test' },
        PAYMENT_TYPES.WECHAT
      )
    ).toBeUndefined()
  })

  test('wraps Alipay HTTPS pay_url for Alipay browser', () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(
      'Mozilla/5.0 Version/18 Mobile Safari/604.1'
    )
    const payUrl = 'https://pay.example.com/checkout?order=1&sign=a%2Bb'
    const link = getInAppPaymentLink(
      { trade_no: '1', pay_url: payUrl },
      PAYMENT_TYPES.ALIPAY
    )
    expect(link).toBe(
      `alipays://platformapi/startapp?appId=20000067&url=${encodeURIComponent(payUrl)}`
    )
  })

  test('wraps Alipay HTTPS pay_url for desktop browser', () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Chrome/130')
    const payUrl = 'https://pay.example.com/checkout'
    const link = getInAppPaymentLink(
      { trade_no: '1', pay_url: payUrl },
      PAYMENT_TYPES.ALIPAY
    )
    expect(link).toBe(
      `alipays://platformapi/startapp?appId=20000067&url=${encodeURIComponent(payUrl)}`
    )
  })

  test('does not wrap Alipay HTTPS in WeChat browser', () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('MicroMessenger/8')
    const payUrl = 'https://pay.example.com/checkout'
    const link = getInAppPaymentLink(
      { trade_no: '1', pay_url: payUrl },
      PAYMENT_TYPES.ALIPAY
    )
    expect(link).toBeUndefined()
  })
})

