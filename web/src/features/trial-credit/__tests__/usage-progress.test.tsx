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
import { act, render, screen } from '@testing-library/react'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { afterEach, expect, test, vi } from 'vitest'

import en from '@/i18n/locales/en.json'
import fr from '@/i18n/locales/fr.json'
import ja from '@/i18n/locales/ja.json'
import ru from '@/i18n/locales/ru.json'
import viLocale from '@/i18n/locales/vi.json'
import zhTW from '@/i18n/locales/zh-TW.json'
import zhCN from '@/i18n/locales/zh.json'
import { api } from '@/lib/api'

import type { TrialGrant } from '../api'
import { TrialBalanceCard } from '../balance-card'

const resources = { en, zhCN, zhTW, fr, ru, ja, vi: viLocale }
const grant: TrialGrant = {
  id: 1,
  type_id: 1,
  type_name: 'Ds credit',
  group: 'Ds',
  quota: 2000000,
  remaining: 1500000,
  expires_at: 0,
  source: 'admin',
}
afterEach(() => vi.restoreAllMocks())
async function mount(
  grants: TrialGrant[],
  language: keyof typeof resources = 'en'
) {
  const i18n = createInstance()
  await i18n.init({
    resources,
    lng: language,
    fallbackLng: 'en',
    nsSeparator: false,
    keySeparator: false,
  })
  vi.spyOn(api, 'get').mockResolvedValue({
    data: {
      success: true,
      data: {
        enabled: true,
        group: 'Ds',
        balance: 1500000,
        total: grants.length,
        grants,
        records: [],
        balances: [],
      },
    },
  })
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={client}>
        <TrialBalanceCard />
      </QueryClientProvider>
    </I18nextProvider>
  )
  await screen.findByRole('button', { name: i18n.t('Next page') })
  return i18n
}
test.each([
  { quota: 2000000, remaining: 1500000, percent: 25 },
  { quota: 2000000, remaining: 2000000, percent: 0 },
  { quota: 2000000, remaining: 0, percent: 100 },
  { quota: 0, remaining: 0, percent: 0 },
  { quota: 2000000, remaining: 2100000, percent: 0 },
  { quota: 2000000, remaining: -100, percent: 100 },
])(
  'total $quota with remaining $remaining displays usage $percent%',
  async ({ quota, remaining, percent }) => {
    await mount([{ ...grant, quota, remaining }])
    const progress = screen.getByRole('progressbar', {
      name: 'Ds credit · Ds · Usage',
    })
    expect(progress).toHaveAttribute('aria-valuenow', String(percent))
    expect(progress).toHaveAttribute('aria-valuemin', '0')
    expect(progress).toHaveAttribute('aria-valuemax', '100')
    expect(screen.getByText(`Used: ${percent}%`)).toBeInTheDocument()
  }
)
test('expired credit displays zero available without counting unused credit as consumed', async () => {
  await mount([{ ...grant, expires_at: Math.floor(Date.now() / 1000) - 60 }])
  expect(screen.getByText(/^Expired · /)).toBeInTheDocument()
  expect(screen.getByText('Remaining: $0 / $4')).toBeInTheDocument()
  expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '25')
})
test('different credits display their own usage progress', async () => {
  await mount([
    grant,
    {
      ...grant,
      id: 2,
      type_id: 2,
      type_name: 'Gpt credit',
      group: 'Gpt',
      remaining: 500000,
    },
  ])
  expect(
    screen.getByRole('progressbar', { name: 'Ds credit · Ds · Usage' })
  ).toHaveAttribute('aria-valuenow', '25')
  expect(
    screen.getByRole('progressbar', { name: 'Gpt credit · Gpt · Usage' })
  ).toHaveAttribute('aria-valuenow', '75')
})
test.each(Object.keys(resources) as Array<keyof typeof resources>)(
  '%s localizes usage labels and keeps currency display',
  async (language) => {
    const i18n = await mount([grant], language)
    expect(
      screen.getByRole('progressbar', {
        name: `Ds credit · Ds · ${i18n.t('Usage')}`,
      })
    ).toHaveAttribute('aria-valuenow', '25')
    expect(
      screen.getByText(`${i18n.t('Remaining')}: $3 / $4`)
    ).toBeInTheDocument()
    expect(screen.getByText(`${i18n.t('Used')}: 25%`)).toBeInTheDocument()
    if (language === 'en') {
      await act(() => i18n.changeLanguage('zhCN'))
      expect(screen.getByText('已使用: 25%')).toBeInTheDocument()
    }
  }
)
