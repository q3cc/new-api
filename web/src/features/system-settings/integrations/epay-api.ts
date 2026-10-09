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
import { api } from '@/lib/api'
import { requireServerSuccess } from '@/lib/server-error-message'

export type EpayEndpoint = {
  id: string
  name: string
  address: string
  merchant_id: string
  enabled: boolean
  has_key: boolean
  key?: string
}

export type EpayConfig = {
  endpoints: EpayEndpoint[]
  pay_methods: Record<string, string>[]
}

export async function getEpayConfig(): Promise<EpayConfig> {
  const response = await api.get('/api/option/epay')
  return requireServerSuccess(response.data).data as EpayConfig
}

export async function saveEpayConfig(config: EpayConfig): Promise<EpayConfig> {
  const response = await api.put('/api/option/epay', config)
  return requireServerSuccess(response.data).data as EpayConfig
}
