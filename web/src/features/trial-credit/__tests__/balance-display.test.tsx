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
import { render, screen } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'

import { api } from '@/lib/api'

import type { TrialGrant } from '../api'
import { TrialBalanceCard } from '../balance-card'

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

async function mount(grants: TrialGrant[]) {
  vi.spyOn(api, 'get').mockResolvedValue({
    data: {
      success: true,
      data: {
        enabled: true,
        group: 'Ds',
        balance: grants.reduce((sum, item) => sum + item.remaining, 0),
        total: grants.length,
        grants,
        records: [],
        balances: [
          { type_id: 1, name: 'Ds credit', group: 'Ds', balance: 1500000 },
        ],
      },
    },
  })
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  render(
    <QueryClientProvider client={client}>
      <TrialBalanceCard />
    </QueryClientProvider>
  )
  await screen.findByRole('progressbar', { name: 'Ds credit · Ds · Usage' })
}

test('a single credit appears once with its balance, usage and expiry', async () => {
  await mount([grant])
  expect(screen.getAllByText(/1 · Ds credit/)).toHaveLength(1)
  expect(screen.getByText('Remaining: $3 / $4')).toBeInTheDocument()
  expect(screen.getByText('Used: 25%')).toBeInTheDocument()
  expect(screen.getByText('Never expires')).toBeInTheDocument()
})

test('different kinds remain independent without duplicate summary entries', async () => {
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
  expect(screen.getAllByText(/1 · Ds credit/)).toHaveLength(1)
  expect(screen.getAllByText(/2 · Gpt credit/)).toHaveLength(1)
  expect(
    screen
      .getAllByRole('progressbar')
      .map((bar) => bar.getAttribute('aria-valuenow'))
  ).toEqual(['25', '75'])
})

test('two grants of the same kind retain their individual amounts and expiry', async () => {
  vi.spyOn(api, 'get').mockResolvedValue({
    data: {
      success: true,
      data: {
        enabled: true,
        group: 'Ds',
        balance: 1750000,
        total: 2,
        records: [],
        grants: [
          grant,
          {
            ...grant,
            id: 2,
            quota: 500000,
            remaining: 250000,
            expires_at: 2000000000,
          },
        ],
        balances: [
          { type_id: 1, name: 'Ds credit', group: 'Ds', balance: 1750000 },
        ],
      },
    },
  })
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  render(
    <QueryClientProvider client={client}>
      <TrialBalanceCard />
    </QueryClientProvider>
  )
  await screen.findByText('Remaining: $0.5 / $1')
  expect(screen.getAllByText(/1 · Ds credit/)).toHaveLength(2)
  expect(
    screen
      .getAllByRole('progressbar')
      .map((bar) => bar.getAttribute('aria-valuenow'))
  ).toEqual(['25', '50'])
  expect(screen.getByText('Never expires')).toBeInTheDocument()
  expect(screen.getByText(/2033/)).toBeInTheDocument()
})
