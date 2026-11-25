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
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'

import type { ClientDevice } from '../../api'
import { ClientDevicesCard } from '../client-devices-card'

const NOW = Math.floor(Date.now() / 1000)

function device(overrides: Partial<ClientDevice>): ClientDevice {
  return {
    id: 7,
    device_id: 'device-7',
    name: 'Lyra Box on iPhone',
    platform: 'ios',
    app_version: '1.2.0',
    verified: true,
    status: 'active',
    created_at: NOW - 3600,
    last_used_at: NOW - 60,
    last_ip: '192.0.2.10',
    ...overrides,
  }
}

let devices: ClientDevice[]

beforeEach(() => {
  devices = [
    device({}),
    device({ id: 8, name: 'Lyra Box on Pixel', platform: 'android', verified: false }),
  ]
  vi.spyOn(api, 'get').mockImplementation(async (url) => {
    if (url === '/api/user/client-devices') {
      return { data: { success: true, data: devices } }
    }
    throw new Error(`Unexpected GET ${url}`)
  })
  vi.spyOn(api, 'delete').mockImplementation(async (url) => {
    const id = Number(String(url).split('/').pop())
    devices = devices.filter((item) => item.id !== id)
    return { data: { success: true, data: { id, current: false } } }
  })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

async function renderCard() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const root = createRootRoute()
  const security = createRoute({ getParentRoute: () => root, path: '/security', component: ClientDevicesCard })
  const signIn = createRoute({ getParentRoute: () => root, path: '/sign-in', component: () => null })
  const router = createRouter({
    routeTree: root.addChildren([security, signIn]),
    history: createMemoryHistory({ initialEntries: ['/security'] }),
  })
  await router.load()
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  )
}

describe('authorized clients card', () => {
  it('lists each authorized client with its platform and whether its build is verified', async () => {
    await renderCard()

    const list = await screen.findByRole('list', { name: 'Authorized clients' })
    const [iphone, pixel] = within(list).getAllByRole('listitem')
    expect(within(iphone).getByText('Lyra Box on iPhone')).toBeTruthy()
    expect(within(iphone).getByText('iOS')).toBeTruthy()
    expect(within(iphone).getByText('Verified client')).toBeTruthy()
    expect(within(pixel).getByText('Android')).toBeTruthy()
    expect(within(pixel).queryByText('Verified client')).toBeNull()
  })

  it('revokes a client only after confirmation and drops it from the list', async () => {
    const user = userEvent.setup()
    await renderCard()
    const list = await screen.findByRole('list', { name: 'Authorized clients' })

    await user.click(within(within(list).getAllByRole('listitem')[0]).getByRole('button', { name: 'Revoke' }))
    expect(api.delete).not.toHaveBeenCalled()
    const dialog = await screen.findByRole('alertdialog')
    await user.click(within(dialog).getByRole('button', { name: 'Revoke' }))

    expect(api.delete).toHaveBeenCalledWith('/api/user/client-devices/7')
    expect(await screen.findByText('Lyra Box on Pixel')).toBeTruthy()
    expect(screen.queryByText('Lyra Box on iPhone')).toBeNull()
  })

  it('explains how to authorize a client when there is none', async () => {
    devices = []
    await renderCard()

    expect(await screen.findByText('No authorized clients')).toBeTruthy()
  })
})
