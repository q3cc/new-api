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
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { login } from '@/features/auth/api'
import { api } from '@/lib/api'

import { getDevAuthUser } from '../dev-auth'

const loginPayload = { username: 'admin', password: 'secret-password' }

beforeEach(() => {
  localStorage.clear()
  // A development server, as `bun run dev` starts it.
  vi.stubEnv('DEV', true)
  vi.stubEnv('MODE', 'development')
  vi.spyOn(api, 'post').mockResolvedValue({
    data: { success: true, message: '', data: { user: { id: 7 } } },
  })
})

afterEach(() => {
  localStorage.clear()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

it('signs in to the real backend on a development server by default', async () => {
  const response = await login(loginPayload)

  expect(api.post).toHaveBeenCalledWith(
    '/api/user/login?turnstile=',
    { username: 'admin', password: 'secret-password' },
    { skipAuthRefresh: true }
  )
  expect(response.data).toMatchObject({ user: { id: 7 } })
  expect(getDevAuthUser()).toBeNull()
})

it('ignores a preview session left in the browser when previews are off', () => {
  localStorage.setItem('dev_auth_session:v1', '{"username":"admin"}')

  expect(getDevAuthUser()).toBeNull()
})

it('uses the offline preview login only when it is turned on', async () => {
  vi.stubEnv('VITE_DEV_AUTH_PREVIEW', 'true')

  const response = await login(loginPayload)

  expect(api.post).not.toHaveBeenCalled()
  expect(response.data).toMatchObject({ user: { username: 'admin' } })
  expect(getDevAuthUser()).toMatchObject({ username: 'admin' })
})
