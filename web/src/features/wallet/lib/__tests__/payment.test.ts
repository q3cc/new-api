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
  let popup: { closed: boolean; location: { href: string }; close: () => void }
  let open: ReturnType<typeof vi.spyOn>
  let navigatedTo: string
  const { location } = window
  const origin = location.href

  /** Capture the form at submission time, before the caller removes it. */
  function captureSubmission() {
    const submitted: {
      action: string
      method: string
      target: string
      fields: [string, string][]
    }[] = []
    vi.spyOn(HTMLFormElement.prototype, 'submit').mockImplementation(
      function (this: HTMLFormElement) {
        submitted.push({
          action: this.getAttribute('action') ?? '',
          method: this.method,
          target: this.target,
          fields: [...this.querySelectorAll('input')].map((input) => [
            input.name,
            input.value,
          ]),
        })
      }
    )
    return submitted
  }

  beforeEach(() => {
    popup = { closed: false, location: { href: '' }, close: vi.fn() }
    open = vi.spyOn(window, 'open').mockReturnValue(popup as unknown as Window)
    // jsdom refuses a real navigation, so the same-tab fallback is observed as
    // an assignment instead.
    navigatedTo = ''
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: {
        ...location,
        set href(value: string) {
          navigatedTo = value
        },
        get href() {
          return navigatedTo || origin
        },
      },
    })
  })
  afterEach(() => {
    vi.restoreAllMocks()
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: location,
    })
    document.querySelectorAll('form').forEach((form) => form.remove())
  })

  test('reserves the tab when opened, so the later submission is not a popup', () => {
    openPaymentWindow()

    // Opening up front, while the click's user activation is still live, is what
    // keeps the submission out of the popup blocker's way.
    expect(open).toHaveBeenCalledTimes(1)
  })

  test('posts the gateway form into the reserved tab with every parameter', () => {
    const submitted = captureSubmission()

    openPaymentWindow().submit('https://pay.example.com/submit', {
      pid: '1001',
      money: '7.00',
      device: 'pc',
    })

    expect(submitted).toEqual([
      {
        action: 'https://pay.example.com/submit',
        method: 'post',
        // The reserved tab already exists, so this opens no new window.
        target: 'new-api-payment',
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

  test('submits in this tab when the browser refused to reserve one', () => {
    open.mockReturnValue(null)
    const submitted = captureSubmission()

    openPaymentWindow().submit('https://pay.example.com/submit', { pid: '1' })

    // A blocked reservation must still deliver the payment instead of dropping it.
    expect(submitted[0]?.target).toBe('_self')
  })

  test('submits in this tab when the reserved tab was already closed', () => {
    const submitted = captureSubmission()
    const window_ = openPaymentWindow()
    popup.closed = true

    window_.submit('https://pay.example.com/submit', { pid: '1' })

    expect(submitted[0]?.target).toBe('_self')
  })

  test('navigates the reserved tab and falls back to this tab when blocked', () => {
    const reserved = openPaymentWindow()
    reserved.navigate('https://pay.example.com/checkout')
    expect(popup.location.href).toBe('https://pay.example.com/checkout')

    open.mockReturnValue(null)
    openPaymentWindow().navigate('https://pay.example.com/checkout')
    expect(navigatedTo).toBe('https://pay.example.com/checkout')
  })

  test('closes only a live reserved tab when the payment never started', () => {
    const reserved = openPaymentWindow()
    reserved.discard()
    expect(popup.close).toHaveBeenCalledTimes(1)

    popup.closed = true
    openPaymentWindow().discard()
    expect(popup.close).toHaveBeenCalledTimes(1)

    open.mockReturnValue(null)
    // A blocked reservation has nothing to close.
    expect(() => openPaymentWindow().discard()).not.toThrow()
  })
})
