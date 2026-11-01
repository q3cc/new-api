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

import type { AffiliateLeaderboard, InviteePage } from './types'

type Envelope<T> = { success: boolean; message?: string; data: T }

export const INVITEES_PAGE_SIZE = 10

export const promotionQueryKeys = {
  leaderboard: ['promotion', 'leaderboard'] as const,
  invitees: (page: number) =>
    ['promotion', 'invitees', page, INVITEES_PAGE_SIZE] as const,
}

export async function getAffiliateLeaderboard(signal?: AbortSignal) {
  const response = await api.get<Envelope<AffiliateLeaderboard>>(
    '/api/user/aff/leaderboard',
    { signal }
  )
  return requireServerSuccess(response.data).data
}

export async function getAffiliateInvitees(page: number, signal?: AbortSignal) {
  const response = await api.get<Envelope<InviteePage>>(
    '/api/user/aff/invitees',
    { params: { p: page, page_size: INVITEES_PAGE_SIZE }, signal }
  )
  return requireServerSuccess(response.data).data
}
