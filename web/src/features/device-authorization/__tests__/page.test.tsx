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
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'

import { DeviceAuthorization } from '..'
import { deviceAuthorizationSearchSchema } from '../lib/user-code'

// The verification ceremony has its own tests; here it yields a fixed proof.
const verify = vi.fn(async () => 'proof-token')
vi.mock('@/features/security/hooks/use-account-security', () => ({
  useAccountSecurity: () => ({
    run: async <T,>(action: (signal: AbortSignal) => Promise<T>) =>
      action(new AbortController().signal),
    verify,
    pending: false,
    verificationDialogProps: {},
  }),
}))
vi.mock('@/features/auth/secure-verification', () => ({
  SecureVerificationDialog: () => null,
}))
const returnToApp = vi.fn()
vi.mock('../lib/return-to-app', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/return-to-app')>()),
  returnToApp: (decision: string) => returnToApp(decision),
}))

const pending = {
  user_code: 'WDJB-MJHT',
  client_name: 'Lyra Box on iPhone',
  platform: 'ios',
  app_version: '1.2.0',
  verified: false,
  request_ip: '192.0.2.10',
  created_at: Math.floor(Date.now() / 1000) - 30,
  expires_at: Math.floor(Date.now() / 1000) + 570,
}

beforeEach(() => {
  verify.mockClear()
  returnToApp.mockClear()
  vi.spyOn(api, 'get').mockImplementation(async (url) => {
    if (url === '/api/user/device-auth/requests/WDJBMJHT') {
      return { data: { success: true, data: pending } }
    }
    return {
      data: {
        success: false,
        code: 'CLIENT_DEVICE_CODE_NOT_FOUND',
        message: 'This code is invalid or has expired.',
      },
    }
  })
  vi.spyOn(api, 'post').mockImplementation(async () => ({
    data: { success: true, data: { status: 'ok' } },
  }))
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

async function renderPage(path: string) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const root = createRootRoute()
  const authenticated = createRoute({
    getParentRoute: () => root,
    id: '_authenticated',
  })
  const device = createRoute({
    getParentRoute: () => authenticated,
    path: '/device/',
    validateSearch: deviceAuthorizationSearchSchema,
    component: DeviceAuthorization,
  })
  const router = createRouter({
    routeTree: root.addChildren([authenticated.addChildren([device])]),
    history: createMemoryHistory({ initialEntries: [path] }),
  })
  await router.load()
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  )
}

describe('device authorization page', () => {
  it('shows what is asking for access and the code to compare when opened from the app', async () => {
    await renderPage('/device?code=wdjb-mjht')

    expect(await screen.findByText('Lyra Box on iPhone')).toBeTruthy()
    expect(screen.getByText('Unverified build')).toBeTruthy()
    expect(screen.getByLabelText('Code').textContent).toBe('WDJB-MJHT')
    expect(screen.getByText('192.0.2.10')).toBeTruthy()
  })

  it('authorizes with a verification proof bound to the code', async () => {
    const user = userEvent.setup()
    await renderPage('/device?code=WDJB-MJHT')

    await user.click(await screen.findByRole('button', { name: 'Authorize' }))

    expect(verify).toHaveBeenCalledWith(
      { scope: 'client_device.authorize', context: { user_code: 'WDJBMJHT' } },
      expect.any(AbortSignal)
    )
    expect(api.post).toHaveBeenCalledWith(
      '/api/user/device-auth/requests/WDJBMJHT/approve',
      undefined,
      expect.objectContaining({
        headers: { 'X-Security-Proof': 'proof-token' },
      })
    )
    expect(await screen.findByText('Device authorized')).toBeTruthy()
  })

  it('denies without asking for verification', async () => {
    const user = userEvent.setup()
    await renderPage('/device?code=WDJB-MJHT')

    await user.click(await screen.findByRole('button', { name: 'Deny' }))

    expect(api.post).toHaveBeenCalledWith(
      '/api/user/device-auth/requests/WDJBMJHT/deny'
    )
    expect(verify).not.toHaveBeenCalled()
    expect(await screen.findByText('Request denied')).toBeTruthy()
  })

  it('stays on the page after a decision when it was not opened from the app sheet', async () => {
    const user = userEvent.setup()
    await renderPage('/device?code=WDJB-MJHT')

    await user.click(await screen.findByRole('button', { name: 'Authorize' }))

    expect(await screen.findByText('Device authorized')).toBeTruthy()
    expect(returnToApp).not.toHaveBeenCalled()
  })

  it('goes back to the app sheet with the decision, and ignores other return values', async () => {
    const user = userEvent.setup()
    await renderPage('/device?code=WDJB-MJHT&return=app')
    await user.click(await screen.findByRole('button', { name: 'Authorize' }))
    expect(await screen.findByText('Device authorized')).toBeTruthy()
    expect(returnToApp).toHaveBeenCalledWith('approved')

    cleanup()
    returnToApp.mockClear()
    await renderPage('/device?code=WDJB-MJHT&return=https://evil.example')
    await user.click(await screen.findByRole('button', { name: 'Deny' }))
    expect(await screen.findByText('Request denied')).toBeTruthy()
    expect(returnToApp).not.toHaveBeenCalled()
  })

  it('says so when a typed code is unknown or expired', async () => {
    const user = userEvent.setup()
    await renderPage('/device')

    const input = screen.getByLabelText('Code shown in the app')
    await user.type(input, 'bbbb cccc')
    await user.click(screen.getByRole('button', { name: 'Continue' }))

    expect(
      await screen.findByText('This code is invalid or has expired.')
    ).toBeTruthy()
    expect(api.get).toHaveBeenCalledWith(
      '/api/user/device-auth/requests/BBBBCCCC',
      expect.anything()
    )
  })
})
