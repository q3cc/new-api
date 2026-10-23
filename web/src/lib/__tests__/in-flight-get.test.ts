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
import type { AxiosAdapter } from 'axios'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { api } from '../api'

const originalAdapter = api.defaults.adapter
let adapter: ReturnType<typeof vi.fn<AxiosAdapter>>

beforeEach(() => {
  // Answers on the next macrotask, so requests stay in flight while the test acts.
  adapter = vi.fn<AxiosAdapter>(
    (config) =>
      new Promise((resolve) =>
        setTimeout(() =>
          resolve({
            data: { success: true, data: config.url },
            status: 200,
            statusText: 'OK',
            headers: {},
            config,
          })
        )
      )
  )
  api.defaults.adapter = adapter
})

afterEach(() => {
  api.defaults.adapter = originalAdapter
  vi.restoreAllMocks()
})

it('concurrent GETs of the same URL without a signal share one request', async () => {
  const [first, second] = await Promise.all([
    api.get('/api/affiliate/summary'),
    api.get('/api/affiliate/summary'),
  ])

  expect(adapter).toHaveBeenCalledTimes(1)
  expect(second).toBe(first)
})

it('a GET started while an earlier one for the same URL is being cancelled still loads', async () => {
  // A remounted query: the first fetch is aborted and the same URL is requested again.
  const unmounted = new AbortController()
  const firstRequest = api.get('/api/affiliate/summary', {
    signal: unmounted.signal,
  })
  unmounted.abort()
  const secondRequest = api.get('/api/affiliate/summary', {
    signal: new AbortController().signal,
  })

  await expect(firstRequest).rejects.toMatchObject({ code: 'ERR_CANCELED' })
  await expect(secondRequest).resolves.toMatchObject({
    data: { data: '/api/affiliate/summary' },
  })
})

it('cancelling one caller does not cancel another caller of the same URL', async () => {
  const leaving = new AbortController()
  const leavingRequest = api.get('/api/affiliate/summary', {
    signal: leaving.signal,
  })
  const stayingRequest = api.get('/api/affiliate/summary', {
    signal: new AbortController().signal,
  })
  leaving.abort()

  await expect(leavingRequest).rejects.toMatchObject({ code: 'ERR_CANCELED' })
  await expect(stayingRequest).resolves.toMatchObject({
    data: { data: '/api/affiliate/summary' },
  })
})
