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
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'

import { TicketSlaDialog } from '../components/ticket-sla-dialog'

let saved: unknown[]
let client: QueryClient

beforeEach(() => {
  saved = []
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  vi.spyOn(api, 'get').mockImplementation(async () => ({
    data: {
      success: true,
      data: {
        sla_urgent_hours: 2,
        sla_high_hours: 8,
        sla_normal_hours: 24,
        sla_low_hours: 72,
      },
    },
  }))
  vi.spyOn(api, 'put').mockImplementation(async (_url, body) => {
    saved.push(body)
    return { data: { success: true, data: body } }
  })
})

afterEach(() => {
  client.clear()
  vi.restoreAllMocks()
})

function renderDialog() {
  render(
    <QueryClientProvider client={client}>
      <TicketSlaDialog open onOpenChange={() => undefined} />
    </QueryClientProvider>
  )
}

it('fills each priority with its saved response target', async () => {
  renderDialog()
  expect(await screen.findByRole('spinbutton', { name: 'Urgent' })).toHaveValue(
    2
  )
  expect(screen.getByRole('spinbutton', { name: 'High' })).toHaveValue(8)
  expect(screen.getByRole('spinbutton', { name: 'Medium' })).toHaveValue(24)
  expect(screen.getByRole('spinbutton', { name: 'Low' })).toHaveValue(72)
})

it('saves the changed targets and refuses hours out of range', async () => {
  const user = userEvent.setup()
  renderDialog()
  const urgent = await screen.findByRole('spinbutton', { name: 'Urgent' })
  await waitFor(() => expect(urgent).toHaveValue(2))
  await user.clear(urgent)
  await user.type(urgent, '0')
  await user.click(screen.getByRole('button', { name: 'Save' }))
  expect(
    await screen.findByText('Enter whole hours from 1 to 720')
  ).toBeInTheDocument()
  expect(saved).toEqual([])

  await user.clear(urgent)
  await user.type(urgent, '4')
  await user.click(screen.getByRole('button', { name: 'Save' }))
  await waitFor(() =>
    expect(saved).toEqual([
      {
        sla_urgent_hours: 4,
        sla_high_hours: 8,
        sla_normal_hours: 24,
        sla_low_hours: 72,
      },
    ])
  )
})
