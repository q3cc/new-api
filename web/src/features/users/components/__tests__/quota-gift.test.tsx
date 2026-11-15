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
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createInstance } from 'i18next'
import { I18nextProvider, initReactI18next } from 'react-i18next'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { api } from '@/lib/api'

import { UserQuotaDialog } from '../user-quota-dialog'

const i18n = createInstance()

beforeEach(async () => {
  // No resources: keys render as written, with values interpolated.
  await i18n.use(initReactI18next).init({
    lng: 'en',
    resources: {},
    nsSeparator: false,
    keySeparator: false,
    interpolation: { escapeValue: false },
  })
  vi.spyOn(api, 'get').mockResolvedValue({
    data: {
      success: true,
      data: { total: 500_000, items: [{ source: 'admin', quota: 500_000 }] },
    },
  })
  vi.spyOn(api, 'post').mockResolvedValue({ data: { success: true } })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

function renderDialog() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={client}>
        <UserQuotaDialog
          open
          onOpenChange={vi.fn()}
          userId={7}
          currentQuota={1_000_000}
          onSuccess={vi.fn()}
        />
      </QueryClientProvider>
    </I18nextProvider>
  )
}

test('the dialog shows the gift credit the user has received', async () => {
  renderDialog()

  expect(
    await screen.findByRole('button', { name: 'Gift credit received: $1' })
  ).toBeVisible()
  expect(api.get).toHaveBeenCalledWith('/api/user/7/gift-quota')
})

test('adding quota marked as gift credit sends the gift flag', async () => {
  renderDialog()

  fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '2' } })
  fireEvent.click(screen.getByRole('checkbox', { name: /Count as gift credit/ }))
  fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))

  await vi.waitFor(() =>
    expect(api.post).toHaveBeenCalledWith('/api/user/manage', {
      id: 7,
      action: 'add_quota',
      mode: 'add',
      value: 1_000_000,
      gift: true,
    })
  )
})

test('subtracting quota offers no gift option and never sends the flag', async () => {
  renderDialog()

  fireEvent.click(screen.getByRole('button', { name: 'Subtract' }))
  expect(
    screen.queryByRole('checkbox', { name: /Count as gift credit/ })
  ).not.toBeInTheDocument()
  fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '2' } })
  fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))

  await vi.waitFor(() =>
    expect(api.post).toHaveBeenCalledWith(
      '/api/user/manage',
      expect.objectContaining({ mode: 'subtract', gift: false })
    )
  )
})
