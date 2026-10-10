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
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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

import { TrialBalanceCard } from '../balance-card'

const resources = { en, zhCN, zhTW, fr, ru, ja, vi: viLocale }
afterEach(() => vi.restoreAllMocks())
async function mount(language: keyof typeof resources) {
  const i18n = createInstance()
  await i18n.init({
    resources,
    lng: language,
    fallbackLng: 'en',
    nsSeparator: false,
    keySeparator: false,
  })
  const get = vi.spyOn(api, 'get').mockResolvedValue({
    data: {
      success: true,
      data: {
        enabled: true,
        group: 'vip',
        balance: 500000,
        total: 11,
        grants: [],
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
  return { i18n, get }
}
test.each(Object.keys(resources) as Array<keyof typeof resources>)(
  '%s uses page labels and preserves paging behavior',
  async (language) => {
    const { i18n, get } = await mount(language)
    const previous = await screen.findByRole('button', {
      name: i18n.t('Previous page'),
    })
    const next = screen.getByRole('button', { name: i18n.t('Next page') })
    expect(previous).toBeDisabled()
    expect(next).toBeEnabled()
    await userEvent.click(next)
    await waitFor(() =>
      expect(get).toHaveBeenCalledWith('/api/user/self/trial-credit', {
        params: { p: 2, page_size: 10 },
      })
    )
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: i18n.t('Next page') })
      ).toBeDisabled()
    )
    await userEvent.click(
      screen.getByRole('button', { name: i18n.t('Previous page') })
    )
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: i18n.t('Previous page') })
      ).toBeDisabled()
    )
  }
)
test('Chinese language switches show 上一页 and 下一页 instead of step labels', async () => {
  const { i18n } = await mount('en')
  await screen.findByRole('button', { name: 'Previous page' })
  await act(() => i18n.changeLanguage('zhCN'))
  expect(screen.getByRole('button', { name: '上一页' })).toBeDisabled()
  expect(screen.getByRole('button', { name: '下一页' })).toBeEnabled()
  expect(
    screen.queryByRole('button', { name: '上一步' })
  ).not.toBeInTheDocument()
  expect(
    screen.queryByRole('button', { name: '下一步' })
  ).not.toBeInTheDocument()
  await act(() => i18n.changeLanguage('zhTW'))
  expect(screen.getByRole('button', { name: '上一頁' })).toBeDisabled()
  expect(screen.getByRole('button', { name: '下一頁' })).toBeEnabled()
})
