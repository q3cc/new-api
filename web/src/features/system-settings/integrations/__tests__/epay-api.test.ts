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
import { expect, it, vi } from 'vitest'

import { api } from '@/lib/api'

import { getEpayConfig, saveEpayConfig } from '../epay-api'

it('saving a service without a new key sends no secret and returns the masked configuration', async () => {
  const config = {
    endpoints: [
      {
        id: 'a',
        name: 'Service A',
        address: 'https://a.example.com',
        merchant_id: '101',
        enabled: true,
        has_key: true,
        mapi: false,
      },
    ],
    pay_methods: [{ name: 'Alipay', type: 'alipay', epay_endpoint_id: 'a' }],
  }
  const put = vi
    .spyOn(api, 'put')
    .mockResolvedValue({ data: { success: true, data: config } })
  expect(await saveEpayConfig(config)).toEqual(config)
  expect(put).toHaveBeenCalledWith('/api/option/epay', config)
  expect(config.endpoints[0]).not.toHaveProperty('key')
})

it('a rejected configuration is a failed save even when the HTTP request succeeds', async () => {
  vi.spyOn(api, 'put').mockResolvedValue({
    data: { success: false, message: 'Services must use separate keys' },
  })
  await expect(
    saveEpayConfig({ endpoints: [], pay_methods: [] })
  ).rejects.toThrow('Services must use separate keys')
})

it('configuration loading rejects server failures instead of returning missing data', async () => {
  vi.spyOn(api, 'get').mockResolvedValue({
    data: { success: false, message: 'Root access required' },
  })
  await expect(getEpayConfig()).rejects.toThrow('Root access required')
})
