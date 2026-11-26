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
import { describe, expect, test } from 'vitest'

import { appCallbackUrl } from '../lib/return-to-app'
import { formatUserCode, normalizeUserCode } from '../lib/user-code'

describe('device user codes', () => {
  test('normalizes a typed code to the eight letters the server compares', () => {
    expect(normalizeUserCode('wdjb-mjht')).toBe('WDJBMJHT')
    expect(normalizeUserCode(' WDJB MJHT ')).toBe('WDJBMJHT')
    expect(normalizeUserCode('WDJB-MJHT-EXTRA')).toBe('WDJBMJHT')
  })

  test('shows a complete code in the XXXX-XXXX form the app uses and leaves partial input alone', () => {
    expect(formatUserCode('WDJBMJHT')).toBe('WDJB-MJHT')
    expect(formatUserCode('WDJ')).toBe('WDJ')
  })
})

describe('return to the app', () => {
  test('links back to the fixed app callback with the decision', () => {
    expect(appCallbackUrl('approved')).toBe(
      'lyrabox://device-auth?status=approved'
    )
    expect(appCallbackUrl('denied')).toBe('lyrabox://device-auth?status=denied')
  })
})
