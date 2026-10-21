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
import { UserRiskSection } from '../user-risk-section'

function Fixture() {
  const [container, setContainer] = useState<HTMLDivElement | null>(null)
  return (
    <>
      <div ref={setContainer} />
      <SettingsPageProvider actionsContainer={container}>
        <UserRiskSection
          defaultValues={{
            'user_risk_setting.enabled': true,
            'user_risk_setting.window_days': 30,
            'user_risk_setting.shared_ip_score': 10,
            'user_risk_setting.same_subnet_score': 2,
            'user_risk_setting.multi_ip_threshold': 10,
            'user_risk_setting.multi_ip_score': 1,
            'user_risk_setting.max_score': 100,
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
  return screen.findByRole('spinbutton', {
    name: 'Score per account sharing an IP',
  })
}

beforeEach(() => {
  vi.spyOn(api, 'put').mockResolvedValue({ data: { success: true } })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

test('saving after changing one weight submits only that setting key', async () => {
  const input = await renderSettings()
  const save = screen.getByRole('button', { name: 'Save risk score settings' })
  expect(input).toHaveValue(10)
  expect(save).toBeDisabled()

  fireEvent.change(input, { target: { value: '15' } })
  await waitFor(() => expect(save).toBeEnabled())
  fireEvent.click(save)

  await waitFor(() =>
    expect(api.put).toHaveBeenCalledWith('/api/option/', {
      key: 'user_risk_setting.shared_ip_score',
      value: 15,
    })
  )
  expect(api.put).toHaveBeenCalledTimes(1)
})

test('an observation window below one day is rejected without saving', async () => {
  await renderSettings()
  const windowInput = screen.getByRole('spinbutton', {
    name: 'Observation window (days)',
  })

  fireEvent.change(windowInput, { target: { value: '0' } })

  expect(windowInput).toHaveValue(1)
  expect(api.put).not.toHaveBeenCalled()
})
