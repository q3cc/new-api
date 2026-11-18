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
import { describe, expect, it } from 'vitest'

import { toIntlLocale } from '@/i18n/languages'

import { formatSlaDuration, responseDue } from '../lib/sla'

describe('responseDue', () => {
  it('counts the time left before the target', () => {
    expect(responseDue(10_000, 9_000)).toEqual({
      overdue: false,
      seconds: 1000,
    })
  })

  it('counts the time past the target once it ran out', () => {
    expect(responseDue(10_000, 13_600)).toEqual({
      overdue: true,
      seconds: 3600,
    })
  })
})

describe('formatSlaDuration', () => {
  it.each([
    [30, '1 minute'],
    [45 * 60, '45 minutes'],
    [3600, '1 hour'],
    [47 * 3600 + 59 * 60, '47 hours'],
    [2 * 86400, '2 days'],
  ])('shows %i seconds as %s', (seconds, text) => {
    expect(formatSlaDuration(seconds, 'en')).toBe(text)
  })

  it.each([
    ['zhCN', '2小时'],
    ['zhTW', '2 小時'],
    ['ja', '2 時間'],
  ])(
    'uses the %s console language once mapped to an Intl locale',
    (language, text) => {
      expect(formatSlaDuration(2 * 3600, toIntlLocale(language))).toBe(text)
    }
  )
})
