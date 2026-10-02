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

export interface TrialConfig {
  enabled: boolean
  group: string
  affiliate: boolean
  affiliate_days: number
}
export interface TrialGrant {
  id: number
  quota: number
  remaining: number
  expires_at: number
  source: string
}
export interface TrialRecord {
  id: number
  actual: number
  trial_charged: number
  wallet_charged: number
  waived: number
  status: string
}
export interface TrialBalance {
  enabled: boolean
  group: string
  balance: number
  grants: TrialGrant[]
  records: TrialRecord[]
  total: number
  records_total?: number
}
export async function getTrialConfig(): Promise<TrialConfig> {
  const r = await api.get('/api/trial-credit/config')
  if (!r.data.success) throw new Error(r.data.message)
  return r.data.data
}
export async function saveTrialConfig(values: TrialConfig) {
  const r = await api.put('/api/trial-credit/config', values)
  if (!r.data.success) throw new Error(r.data.message)
}
export async function grantTrialCredit(
  userId: number,
  values: { quota: number; expires_at: number; request_id: string }
) {
  const r = await api.post(`/api/user/${userId}/trial-credit`, values)
  if (!r.data.success) throw new Error(r.data.message)
}
export async function getTrialBalance(page: number): Promise<TrialBalance> {
  const r = await api.get('/api/user/self/trial-credit', {
    params: { p: page, page_size: 10 },
  })
  if (!r.data.success) throw new Error(r.data.message)
  return r.data.data
}
