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

export interface TrialCreditType {
  id: number
  name: string
  group: string
  enabled: boolean
}
export interface TrialConfig {
  types: TrialCreditType[]
  affiliate_type_id: number
  enabled: boolean
  group: string
  affiliate: boolean
  affiliate_days: number
}
export interface TrialGrant {
  type_id: number
  type_name: string
  group: string
  id: number
  quota: number
  remaining: number
  expires_at: number
  source: string
}
export interface TrialRecord {
  group: string
  id: number
  actual: number
  trial_charged: number
  wallet_charged: number
  waived: number
  status: string
}
export interface TrialBalance {
  balances?: { type_id: number; name: string; group: string; balance: number }[]
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
  const data = r.data.data as TrialConfig
  return {
    ...data,
    types:
      data.types ??
      (data.group
        ? [{ id: 1, name: 'Trial credit', group: data.group, enabled: true }]
        : []),
    affiliate_type_id: data.affiliate_type_id ?? 1,
  }
}
export async function saveTrialConfig(values: TrialConfig) {
  const r = await api.put('/api/trial-credit/config', values)
  if (!r.data.success) throw new Error(r.data.message)
  return r.data.data as TrialConfig | undefined
}
export async function grantTrialCredit(
  userId: number,
  values: {
    type_id: number
    quota: number
    expires_at: number
    request_id: string
  }
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

export async function getTrialTypes(): Promise<TrialCreditType[]> {
  const r = await api.get('/api/trial-credit/types')
  if (!r.data.success) throw new Error(r.data.message)
  return r.data.data
}
