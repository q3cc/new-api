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
import { getServerMessage } from '@/lib/server-error-message'

import {
  PAYMENT_TYPES,
  DEFAULT_PRESET_MULTIPLIERS,
  DEFAULT_PAYMENT_TYPE,
  DEFAULT_MIN_TOPUP,
} from '../constants'
import type { PaymentMethod, PresetAmount, TopupInfo } from '../types'

// ============================================================================
// Payment Processing Functions
// ============================================================================

export type RechargeBrowser = 'WeChat' | 'Alipay' | 'QQ'

export function getRechargeBrowser(
  userAgent = typeof navigator === 'undefined' ? '' : navigator.userAgent
): RechargeBrowser | null {
  if (/MicroMessenger/i.test(userAgent)) return 'WeChat'
  if (/AlipayClient/i.test(userAgent)) return 'Alipay'
  // MQQBrowser alone also identifies the standalone QQ browser.
  if (/\bQQ\//i.test(userAgent)) return 'QQ'
  return null
}

/**
 * Payment endpoints answer errors as {"message": "error", "data": text}. When
 * the response also carries a message_key, this is its translation; callers
 * fall back to the text they already read.
 */
export function getPaymentErrorTranslation(
  response: unknown
): string | undefined {
  if (!response || typeof response !== 'object') return undefined
  const body = response as Record<string, unknown>
  if (typeof body.message_key !== 'string' || !body.message_key) {
    return undefined
  }
  return getServerMessage(body)
}

/**
 * Reserve a tab for a gateway page, then drive it once the order exists.
 *
 * A gateway URL only becomes known after the order request resolves, but by then
 * the click's user activation has expired, so asking for a new tab at that point
 * is treated as a popup and silently blocked — the order is created and the user
 * is never sent anywhere. Opening the tab up front, while the activation is
 * still live, keeps the submission inside an already-open window where no popup
 * blocker applies.
 */
export interface PaymentWindow {
  /** POST the gateway form into the reserved tab. False when it was closed. */
  submit: (url: string, params: Record<string, unknown>) => boolean
  /** Point the reserved tab at a gateway URL. False when it was closed. */
  navigate: (url: string) => boolean
  /** Close the reserved tab when the payment never started. */
  closeIfUnused: () => void
}

export function openPaymentWindow(): PaymentWindow {
  // A per-payment name: reusing one name would let a leftover gateway tab from
  // an earlier attempt swallow this navigation.
  const name = `new-api-payment-${Math.random().toString(36).slice(2, 10)}`
  const popup = window.open('', name)
  if (popup) {
    // The gateway page must not be able to reach back into the dashboard.
    // `noopener` in the feature string would drop the reference we need to
    // drive the tab later, so clear the handle instead.
    popup.opener = null
  }
  let navigated = false

  return {
    submit(url, params) {
      const form = document.createElement('form')
      form.action = url
      form.method = 'POST'
      // A closed reservation is not redirected into this tab: replacing the
      // dashboard with a gateway that then fails is the blank page users saw.
      if (!popup || popup.closed) return false
      form.target = name
      Object.entries(params).forEach(([key, value]) => {
        const input = document.createElement('input')
        input.type = 'hidden'
        input.name = key
        input.value = String(value)
        form.appendChild(input)
      })
      document.body.appendChild(form)
      try {
        form.submit()
      } finally {
        form.remove()
      }
      navigated = true
      return true
    },
    navigate(url) {
      if (!popup || popup.closed) return false
      try {
        // replace() is what Safari accepts for a cross-origin assignment.
        popup.location.replace(url)
      } catch {
        return false
      }
      navigated = true
      return true
    },
    closeIfUnused() {
      if (navigated) return
      if (popup && !popup.closed) popup.close()
    },
  }
}

/**
 * Check if payment method is Stripe
 */
export function isStripePayment(paymentType: string): boolean {
  return paymentType === PAYMENT_TYPES.STRIPE
}

/**
 * Check if payment method is Waffo
 */
export function isWaffoPayment(paymentType: string): boolean {
  return paymentType === PAYMENT_TYPES.WAFFO
}

/**
 * Check if payment method is Waffo Pancake
 *
 * Pancake is a metered-style payment that goes through a dedicated checkout
 * URL flow rather than the generic epay form submission, so it must be
 * special-cased in payment dispatch logic.
 */
export function isWaffoPancakePayment(paymentType: string): boolean {
  return paymentType === PAYMENT_TYPES.WAFFO_PANCAKE
}

export interface PaymentProcessors {
  regular: (topupAmount: number, paymentType: string) => Promise<boolean>
  waffo: (topupAmount: number, payMethodIndex: number) => Promise<boolean>
  waffoPancake: (topupAmount: number) => Promise<boolean>
}

export async function dispatchSelectedPayment(
  paymentMethod: PaymentMethod,
  topupAmount: number,
  waffoMethodIndex: number | null,
  processors: PaymentProcessors
): Promise<boolean> {
  if (isWaffoPayment(paymentMethod.type)) {
    if (waffoMethodIndex === null) {
      return false
    }
    return processors.waffo(topupAmount, waffoMethodIndex)
  }

  if (isWaffoPancakePayment(paymentMethod.type)) {
    return processors.waffoPancake(topupAmount)
  }

  return processors.regular(topupAmount, paymentMethod.id || paymentMethod.type)
}

/**
 * Get default payment type from topup info
 */
export function getDefaultPaymentType(topupInfo: TopupInfo | null): string {
  if (!topupInfo) {
    return DEFAULT_PAYMENT_TYPE
  }

  // Return first available payment method or default
  if (topupInfo.pay_methods?.length > 0) {
    return topupInfo.pay_methods[0].type
  }

  if (topupInfo.enable_stripe_topup) {
    return PAYMENT_TYPES.STRIPE
  }

  if (topupInfo.enable_waffo_topup) {
    return PAYMENT_TYPES.WAFFO
  }

  if (topupInfo.enable_waffo_pancake_topup) {
    return PAYMENT_TYPES.WAFFO_PANCAKE
  }

  return DEFAULT_PAYMENT_TYPE
}

/**
 * Get minimum topup amount from topup info
 */
export function getMinTopupAmount(topupInfo: TopupInfo | null): number {
  if (!topupInfo) {
    return DEFAULT_MIN_TOPUP
  }

  if (topupInfo.enable_online_topup) {
    return topupInfo.min_topup
  }

  if (topupInfo.enable_stripe_topup) {
    return topupInfo.stripe_min_topup
  }

  if (topupInfo.enable_waffo_topup) {
    return topupInfo.waffo_min_topup || DEFAULT_MIN_TOPUP
  }

  if (topupInfo.enable_waffo_pancake_topup) {
    return topupInfo.waffo_pancake_min_topup || DEFAULT_MIN_TOPUP
  }

  return DEFAULT_MIN_TOPUP
}

/**
 * Generate preset amounts based on minimum topup
 */
export function generatePresetAmounts(minAmount: number): PresetAmount[] {
  return DEFAULT_PRESET_MULTIPLIERS.map((multiplier) => ({
    value: minAmount * multiplier,
  }))
}

/**
 * Merge custom preset amounts with discounts
 */
export function mergePresetAmounts(
  amountOptions: number[],
  discounts: Record<number, number>
): PresetAmount[] {
  if (!amountOptions || amountOptions.length === 0) {
    return []
  }

  return amountOptions.map((amount) => ({
    value: amount,
    discount: discounts[amount] || 1.0,
  }))
}
