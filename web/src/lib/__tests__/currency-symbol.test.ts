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
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { INTERFACE_LANGUAGE_OPTIONS, toIntlLocale } from '@/i18n/languages'
import { formatCurrencyFromUSD } from '@/lib/currency'
import {
  DEFAULT_CURRENCY_CONFIG,
  useSystemConfigStore,
} from '@/stores/system-config-store'

// Every interface language, plus one that is not a valid locale tag.
const languages = [
  ...INTERFACE_LANGUAGE_OPTIONS.map((option) => option.code),
  'not a language',
]

beforeEach(() => {
  useSystemConfigStore
    .getState()
    .setConfig({ currency: { ...DEFAULT_CURRENCY_CONFIG } })
})

afterEach(() => {
  vi.restoreAllMocks()
})

test.each(languages)(
  'in %s a supported browser shows the narrow currency symbol',
  (language) => {
    const formatted = formatCurrencyFromUSD(12.5, {
      locale: toIntlLocale(language),
    })

    expect(formatted).toContain('$')
    expect(formatted).not.toContain('US')
    expect(formatted).toMatch(/12[.,]5/)
  }
)

test.each(languages)(
  'in %s a browser without narrowSymbol falls back to the regular symbol',
  (language) => {
    const NativeNumberFormat = Intl.NumberFormat
    const constructed: (string | undefined)[] = []
    // Safari before 14.1 and Chrome before 77 throw for this option value.
    vi.spyOn(Intl, 'NumberFormat').mockImplementation(function (
      locales?: Intl.LocalesArgument,
      options?: Intl.NumberFormatOptions
    ) {
      constructed.push(options?.currencyDisplay)
      if (options?.currencyDisplay === 'narrowSymbol') {
        throw new RangeError('Value narrowSymbol out of range')
      }
      return new NativeNumberFormat(locales, options)
    } as unknown as typeof Intl.NumberFormat)

    const formatted = formatCurrencyFromUSD(12.5, {
      locale: toIntlLocale(language),
    })

    expect(constructed).toEqual(['narrowSymbol', 'symbol'])
    expect(formatted).toContain('$')
    expect(formatted).toMatch(/12[.,]5/)
  }
)
