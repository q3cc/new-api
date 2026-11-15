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
import { expect, test } from 'vitest'

import type { Redemption } from '../../types'
import {
  REDEMPTION_FORM_DEFAULT_VALUES,
  transformFormDataToPayload,
  transformRedemptionToFormDefaults,
} from '../redemption-form'

const usedCode: Redemption = {
  id: 1,
  user_id: 1,
  name: 'promo',
  key: 'k',
  status: 1,
  quota: 500_000,
  redemption_type: 'balance',
  created_time: 0,
  redeemed_time: 0,
  expired_time: 0,
  used_user_id: 0,
}

test('a balance code marked as a gift is sent with the gift flag', () => {
  const payload = transformFormDataToPayload({
    ...REDEMPTION_FORM_DEFAULT_VALUES,
    name: 'promo',
    gift: true,
  })

  expect(payload.gift).toBe(true)
})

test('a subscription code never carries the gift flag', () => {
  const payload = transformFormDataToPayload({
    ...REDEMPTION_FORM_DEFAULT_VALUES,
    name: 'pass',
    redemption_type: 'subscription',
    plan_id: 3,
    gift: true,
  })

  expect(payload.gift).toBe(false)
})

test('editing a code keeps its gift flag and treats a missing flag as not a gift', () => {
  expect(transformRedemptionToFormDefaults({ ...usedCode, gift: true }).gift).toBe(
    true
  )
  expect(transformRedemptionToFormDefaults(usedCode).gift).toBe(false)
})
