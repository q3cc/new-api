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
import z from 'zod'

import { api } from '@/lib/api'
import { requireServerSuccess } from '@/lib/server-error-message'

import type {
  AffiliateInvite,
  AffiliateInviteLog,
  AffiliateRebate,
  AffiliateSummary,
  ReferralPage,
} from './types'

export const referralsSearchSchema = z.object({
  tab: z.enum(['invites', 'rebates', 'logs']).optional().catch(undefined),
  page: z.number().int().min(1).optional().catch(1),
  pageSize: z.number().int().min(1).max(100).optional().catch(20),
  user_id: z.number().int().positive().optional().catch(undefined),
  keyword: z.string().max(255).optional().catch(''),
  status: z
    .enum(['pending', 'review', 'confirmed', 'rejected'])
    .optional()
    .catch(undefined),
  action: z.enum(['cancel', 'restore']).optional().catch(undefined),
})
export type ReferralsSearch = z.infer<typeof referralsSearchSchema>

/** Query keys share this root so an action refreshes every referral view. */
export const REFERRALS_QUERY_KEY = 'admin-referrals'

type Envelope<T> = { success: boolean; message?: string; data: T }

type PageParams = { page?: number; pageSize?: number; user_id?: number }

function pageParams(params: PageParams) {
  return {
    p: params.page ?? 1,
    page_size: params.pageSize ?? 20,
    user_id: params.user_id,
  }
}

export async function getReferralSummary(signal?: AbortSignal) {
  const response = await api.get<Envelope<AffiliateSummary>>(
    '/api/affiliate/summary',
    { signal }
  )
  return requireServerSuccess(response.data).data
}

export async function getAffiliateInvites(
  params: PageParams & { keyword?: string },
  signal?: AbortSignal
) {
  const response = await api.get<Envelope<ReferralPage<AffiliateInvite>>>(
    '/api/affiliate/invites',
    {
      params: { ...pageParams(params), keyword: params.keyword || undefined },
      signal,
    }
  )
  return requireServerSuccess(response.data).data
}

export async function getAffiliateRebates(
  params: PageParams & { status?: string },
  signal?: AbortSignal
) {
  const response = await api.get<Envelope<ReferralPage<AffiliateRebate>>>(
    '/api/affiliate/rebates',
    { params: { ...pageParams(params), status: params.status }, signal }
  )
  return requireServerSuccess(response.data).data
}

export async function getAffiliateInviteLogs(
  params: PageParams & { action?: string },
  signal?: AbortSignal
) {
  const response = await api.get<Envelope<ReferralPage<AffiliateInviteLog>>>(
    '/api/affiliate/invite-logs',
    { params: { ...pageParams(params), action: params.action }, signal }
  )
  return requireServerSuccess(response.data).data
}

async function postNote(url: string, note: string) {
  const response = await api.post<Envelope<null>>(url, { note })
  return requireServerSuccess(response.data)
}

export function cancelAffiliateInvite(inviteeId: number, note: string) {
  return postNote(`/api/affiliate/invites/${inviteeId}/cancel`, note)
}

export function restoreAffiliateInvite(logId: number, note: string) {
  return postNote(`/api/affiliate/invite-logs/${logId}/restore`, note)
}

export function approveAffiliateRebate(rebateId: number, note: string) {
  return postNote(`/api/affiliate/rebates/${rebateId}/approve`, note)
}

export function rejectAffiliateRebate(rebateId: number, note: string) {
  return postNote(`/api/affiliate/rebates/${rebateId}/reject`, note)
}
