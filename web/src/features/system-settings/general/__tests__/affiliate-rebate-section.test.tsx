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
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { useState } from 'react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { api } from '@/lib/api'

import { SettingsPageProvider } from '../../components/settings-page-context'
import { AffiliateRebateSection } from '../affiliate-rebate-section'

function Fixture() {
  const [container, setContainer] = useState<HTMLDivElement | null>(null)
  return (
    <>
      <div ref={setContainer} />
      <SettingsPageProvider actionsContainer={container}>
        <AffiliateRebateSection
          defaultValues={{
            QuotaForInviter: 500_000,
            QuotaForInvitee: 0,
            'affiliate_rebate_setting.enabled': true,
            'affiliate_rebate_setting.rate_percent': 10,
            'affiliate_rebate_setting.confirm_days': 7,
            'affiliate_rebate_setting.risk_review_score': 50,
            'affiliate_rebate_setting.cancel_shared_ip': true,
          }}
        />
      </SettingsPageProvider>
    </>
  )
}

async function renderSettings() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const router = createRouter({
    routeTree: createRootRoute({ component: Fixture }),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  )
  return screen.findByRole('spinbutton', { name: 'Rebate rate (%)' })
}

beforeEach(() => {
  vi.spyOn(api, 'put').mockResolvedValue({ data: { success: true } })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

test('saving a decimal rebate rate submits only that setting key as a number', async () => {
  const input = await renderSettings()
  const save = screen.getByRole('button', {
    name: 'Save referral rebate settings',
  })
  expect(save).toBeDisabled()

  fireEvent.change(input, { target: { value: '12.5' } })
  await waitFor(() => expect(save).toBeEnabled())
  fireEvent.click(save)

  await waitFor(() =>
    expect(api.put).toHaveBeenCalledWith('/api/option/', {
      key: 'affiliate_rebate_setting.rate_percent',
      value: 12.5,
    })
  )
  expect(api.put).toHaveBeenCalledTimes(1)
})

test('changing the inviter reward saves it under its original option key', async () => {
  await renderSettings()
  const field = screen.getByRole('spinbutton', { name: 'Inviter Reward' })
  expect(field).toHaveValue(500_000)

  fireEvent.change(field, { target: { value: '1000' } })
  const save = screen.getByRole('button', {
    name: 'Save referral rebate settings',
  })
  await waitFor(() => expect(save).toBeEnabled())
  fireEvent.click(save)

  await waitFor(() =>
    expect(api.put).toHaveBeenCalledWith('/api/option/', {
      key: 'QuotaForInviter',
      value: 1000,
    })
  )
  expect(api.put).toHaveBeenCalledTimes(1)
})

test.each([
  ['Rebate rate (%)', '100.5', 'Rebate rate must be between 0 and 100'],
  ['Rebate rate (%)', '1.234', 'Rebate rate allows at most two decimal places'],
  [
    'Confirmation period (days)',
    '91',
    'Confirmation period must be between 0 and 90 days',
  ],
])(
  'entering %s of %s shows a validation error and saves nothing',
  async (name, value, message) => {
    await renderSettings()
    const field = screen.getByRole('spinbutton', { name })

    fireEvent.change(field, { target: { value } })
    expect(await screen.findByText(message)).toBeVisible()
    fireEvent.click(
      screen.getByRole('button', { name: 'Save referral rebate settings' })
    )

    await waitFor(() => expect(field).toHaveAttribute('aria-invalid', 'true'))
    expect(api.put).not.toHaveBeenCalled()
  }
)
