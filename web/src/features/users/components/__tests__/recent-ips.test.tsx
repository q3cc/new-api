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
import { formatTimestampToDate } from '@/lib/format'

import { UserRecentIpsSection } from '../user-recent-ips-section'

const clients: QueryClient[] = []
const i18n = createInstance()
await i18n.init({
  lng: 'en',
  resources: { en: { translation: {} } },
  initAsync: false,
})

function renderSection(userId: number) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  clients.push(client)
  return render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={client}>
        <TooltipProvider>
          <UserRecentIpsSection userId={userId} />
        </TooltipProvider>
      </QueryClientProvider>
    </I18nextProvider>
  )
}

afterEach(() => {
  cleanup()
  clients.splice(0).forEach((client) => client.clear())
  vi.restoreAllMocks()
})

it('lists recent IPs in server order with last-seen time when the user has records', async () => {
  const get = vi.spyOn(api, 'get').mockResolvedValue({
    data: {
      success: true,
      data: [
        { ip: '198.51.100.2', last_seen: 1_790_000_200 },
        { ip: '2001:db8::1', last_seen: 1_790_000_100 },
      ],
    },
  })

  renderSection(42)

  const list = await screen.findByRole('list', { name: 'Recent IPs' })
  const items = within(list).getAllByRole('listitem')
  expect(get).toHaveBeenCalledWith('/api/user/42/recent_ips')
  expect(items).toHaveLength(2)
  expect(within(items[0]).getByText('198.51.100.2')).toBeInTheDocument()
  expect(
    within(items[0]).getByText(formatTimestampToDate(1_790_000_200))
  ).toBeInTheDocument()
  expect(within(items[1]).getByText('2001:db8::1')).toBeInTheDocument()
  expect(
    within(items[0]).getByRole('button', { name: 'Copy to clipboard' })
  ).toHaveAttribute('type', 'button')
})

it('shows an empty message when the user has no recorded IPs', async () => {
  vi.spyOn(api, 'get').mockResolvedValue({
    data: { success: true, data: [] },
  })

  renderSection(7)

  expect(await screen.findByText('No IP records')).toBeInTheDocument()
  expect(screen.queryByRole('list')).not.toBeInTheDocument()
})
