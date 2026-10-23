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
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react'
import { createInstance } from 'i18next'
import { I18nextProvider, initReactI18next } from 'react-i18next'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { api } from '@/lib/api'

import { walletQueryKeys } from '../api'
import { AffiliateRewardsCard } from '../components/affiliate-rewards-card'
import type { AffiliateRebatesData, UserWalletData } from '../types'

const user = {
  aff_quota: 0,
  aff_history_quota: 0,
  aff_count: 2,
} as UserWalletData

function mockRebates(data: AffiliateRebatesData) {
  return vi.spyOn(api, 'get').mockResolvedValue({
    data: { success: true, data },
  })
}

const enabledRebates: AffiliateRebatesData = {
  enabled: true,
  rate_percent: 12.5,
  confirm_days: 7,
  pending_quota: 1_000_000,
  page: {
    page: 1,
    page_size: 10,
    total: 2,
    items: [
      {
        id: 2,
        invitee_id: 12,
        source: 'subscription',
        base_quota: 500_000,
        rate_bps: 1250,
        quota: 62_500,
        status: 'review',
        reason: 'Invitee risk score is too high',
        confirm_at: 1_700_000_000,
        confirmed_at: 0,
        created_at: 1_699_000_000,
      },
      {
        id: 1,
        invitee_id: 11,
        source: 'topup',
        base_quota: 500_000,
        rate_bps: 1250,
        quota: 62_500,
        status: 'confirmed',
        reason: '',
        confirm_at: 1_700_000_000,
        confirmed_at: 1_700_000_100,
        created_at: 1_699_000_000,
      },
    ],
  },
}

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
})

function renderCard() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={client}>
        <AffiliateRewardsCard
          user={user}
          affiliateLink='https://example.com/register?aff=abc'
          onTransfer={vi.fn()}
        />
      </QueryClientProvider>
    </I18nextProvider>
  )
  return client
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

test('with rebates enabled the card shows the amount still confirming and the rate', async () => {
  mockRebates(enabledRebates)
  renderCard()

  const label = await screen.findByText('Confirming')
  expect(label.nextElementSibling).toHaveTextContent(/^\$2$/)
  expect(
    screen.getByText(
      'You earn 12.5% of every payment made by users you invite, credited after 7 days.'
    )
  ).toBeVisible()
  expect(api.get).toHaveBeenCalledWith('/api/user/aff/rebates', {
    params: { p: 1, page_size: 10 },
  })
})

test('opening rebate details lists each rebate with its invitee id, status and reason', async () => {
  mockRebates(enabledRebates)
  renderCard()

  fireEvent.click(await screen.findByRole('button', { name: 'Rebate details' }))

  const dialog = await screen.findByRole('dialog')
  const rows = within(dialog).getAllByRole('row').slice(1)
  expect(rows).toHaveLength(2)
  expect(rows[0]).toHaveTextContent('#12')
  expect(within(rows[0]).getByText('Under review')).toBeVisible()
  expect(
    within(rows[0]).getByText('Invitee risk score is too high')
  ).toBeVisible()
  expect(rows[1]).toHaveTextContent('#11')
  expect(within(rows[1]).getByText('Credited')).toBeVisible()
})

test('with rebates disabled the card shows neither the confirming amount nor the details button', async () => {
  mockRebates({
    ...enabledRebates,
    enabled: false,
    pending_quota: 0,
    page: { page: 1, page_size: 10, total: 0, items: [] },
  })
  const client = renderCard()

  await vi.waitFor(() =>
    expect(
      client.getQueryState(walletQueryKeys.affiliateRebates(1, 10))?.status
    ).toBe('success')
  )
  expect(screen.getByText('Transferable')).toBeVisible()
  expect(screen.queryByText('Confirming')).not.toBeInTheDocument()
  expect(
    screen.queryByRole('button', { name: 'Rebate details' })
  ).not.toBeInTheDocument()
})
