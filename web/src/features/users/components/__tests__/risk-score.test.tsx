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
import { cleanup, render, screen, within } from '@testing-library/react'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { afterEach, expect, it, vi } from 'vitest'

import { TooltipProvider } from '@/components/ui/tooltip'
import { api } from '@/lib/api'

import { UserRiskBadge } from '../user-risk-badge'
import { UserRiskSection } from '../user-risk-section'

const clients: QueryClient[] = []
const i18n = createInstance()
await i18n.init({
  lng: 'en',
  resources: { en: { translation: {} } },
  initAsync: false,
})

function renderWithProviders(node: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  clients.push(client)
  return render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={client}>
        <TooltipProvider>{node}</TooltipProvider>
      </QueryClientProvider>
    </I18nextProvider>
  )
}

afterEach(() => {
  cleanup()
  clients.splice(0).forEach((client) => client.clear())
  vi.restoreAllMocks()
})

it('shows a zero badge when a user has no risk score yet', () => {
  renderWithProviders(<UserRiskBadge />)

  const badge = screen.getByLabelText('Risk score 0')
  expect(badge).toHaveTextContent(/^0$/)
  expect(badge).toHaveClass('text-success')
})

it.each([
  [29, 'text-success'],
  [30, 'text-warning'],
  [60, 'text-destructive'],
])('colors a badge with score %i as %s', (score, colorClass) => {
  renderWithProviders(
    <UserRiskBadge
      risk={{
        score,
        shared_ip_users: 1,
        same_subnet_users: 0,
        ip_count: 1,
        updated_at: 1,
      }}
    />
  )

  const badge = screen.getByLabelText(`Risk score ${score}`)
  expect(badge).toHaveTextContent(String(score))
  expect(badge).toHaveClass(colorClass)
})

it('lists related accounts with their shared IPs and ranges in the edit drawer section', async () => {
  const get = vi.spyOn(api, 'get').mockResolvedValue({
    data: {
      success: true,
      data: {
        score: {
          score: 12,
          shared_ip_users: 1,
          same_subnet_users: 1,
          ip_count: 3,
          updated_at: 1_790_000_000,
        },
        details: {
          shared_ip: [
            {
              user_id: 8,
              username: 'partner',
              matches: ['198.51.100.1', '203.0.113.10'],
            },
          ],
          same_subnet: [{ user_id: 9, matches: ['203.0.113.0/24'] }],
        },
      },
    },
  })

  renderWithProviders(<UserRiskSection userId={5} />)

  const shared = await screen.findByRole('list', {
    name: 'Accounts sharing an IP',
  })
  expect(get).toHaveBeenCalledWith('/api/user/5/risk')
  expect(within(shared).getByText('partner')).toBeInTheDocument()
  expect(
    within(shared).getByText('198.51.100.1, 203.0.113.10')
  ).toBeInTheDocument()
  const subnet = screen.getByRole('list', {
    name: 'Accounts in the same IP range',
  })
  expect(within(subnet).getByText('Deleted user')).toBeInTheDocument()
  expect(within(subnet).getByText('203.0.113.0/24')).toBeInTheDocument()
  expect(screen.getByText('12')).toBeInTheDocument()
})

it('shows only the summary when no other accounts are related', async () => {
  vi.spyOn(api, 'get').mockResolvedValue({
    data: {
      success: true,
      data: {
        score: {
          score: 0,
          shared_ip_users: 0,
          same_subnet_users: 0,
          ip_count: 0,
          updated_at: 0,
        },
        details: { shared_ip: [], same_subnet: [] },
      },
    },
  })

  renderWithProviders(<UserRiskSection userId={6} />)

  expect(await screen.findByText('Distinct IPs')).toBeInTheDocument()
  expect(screen.queryByRole('list')).not.toBeInTheDocument()
})
