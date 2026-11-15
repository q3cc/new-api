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
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createInstance } from 'i18next'
import { I18nextProvider, initReactI18next } from 'react-i18next'
import { afterEach, beforeEach, expect, test } from 'vitest'

import { WalletStatsCard } from '../components/wallet-stats-card'
import type { GiftQuotaSummary, UserWalletData } from '../types'

const user = {
  quota: 5_000_000,
  used_quota: 1_000_000,
  request_count: 3,
} as UserWalletData

const summary: GiftQuotaSummary = {
  total: 1_500_000,
  items: [
    { source: 'registration', quota: 250_000 },
    { source: 'topup', quota: 500_000 },
    { source: 'lottery', quota: 750_000 },
  ],
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

afterEach(() => {
  cleanup()
})

function renderCard(giftQuota?: GiftQuotaSummary) {
  render(
    <I18nextProvider i18n={i18n}>
      <WalletStatsCard user={user} giftQuota={giftQuota} />
    </I18nextProvider>
  )
}

test('with a gift summary the balance shows the cumulative gift credit', () => {
  renderCard(summary)

  expect(
    screen.getByRole('button', { name: 'Gift credit received: $3' })
  ).toBeVisible()
  expect(screen.queryByText('Remaining quota')).not.toBeInTheDocument()
})

test('opening the gift credit lists each source and the total', async () => {
  renderCard(summary)

  fireEvent.click(
    screen.getByRole('button', { name: 'Gift credit received: $3' })
  )

  const title = await screen.findByText('About gift credit')
  const details = title.parentElement
  expect(details).toHaveTextContent('Sign-up bonus$0.5')
  expect(details).toHaveTextContent('Top-up bonus$1')
  expect(details).toHaveTextContent('Lottery prizes$1.5')
  expect(details).toHaveTextContent('Total gift credit received$3')
  expect(details).not.toHaveTextContent('Check-in rewards')
})

test('without a gift summary the balance keeps its usual description', () => {
  renderCard()

  expect(screen.getByText('Remaining quota')).toBeInTheDocument()
  expect(
    screen.queryByRole('button', { name: /Gift credit received/ })
  ).not.toBeInTheDocument()
})
