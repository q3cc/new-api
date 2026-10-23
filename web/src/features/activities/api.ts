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

import type {
  ApiResponse,
  LotteryActivity,
  LotteryActivityPayload,
  LotteryActivityView,
  LotteryEntry,
  LotteryEntryPage,
  LotteryWin,
} from './types'

export const activitiesQueryKeys = {
  all: ['lottery'] as const,
  list: () => [...activitiesQueryKeys.all, 'activities'] as const,
  wins: () => [...activitiesQueryKeys.all, 'wins'] as const,
  admin: () => [...activitiesQueryKeys.all, 'admin'] as const,
  entries: (activityId: number, page: number, winnersOnly: boolean) =>
    [
      ...activitiesQueryKeys.admin(),
      'entries',
      activityId,
      page,
      winnersOnly,
    ] as const,
}

export async function getActivities(): Promise<
  ApiResponse<LotteryActivityView[]>
> {
  const res = await api.get('/api/lottery/activities')
  return res.data
}

export async function joinActivity(id: number): Promise<ApiResponse> {
  const res = await api.post(`/api/lottery/activities/${id}/join`)
  return res.data
}

export async function spinWheel(
  id: number
): Promise<ApiResponse<LotteryEntry>> {
  const res = await api.post(`/api/lottery/activities/${id}/spin`)
  return res.data
}

export async function getSelfWins(): Promise<ApiResponse<LotteryWin[]>> {
  const res = await api.get('/api/lottery/wins/self')
  return res.data
}

export async function getAdminActivities(): Promise<
  ApiResponse<LotteryActivity[]>
> {
  const res = await api.get('/api/lottery/admin/activities')
  return res.data
}

export async function createActivity(
  data: LotteryActivityPayload
): Promise<ApiResponse<LotteryActivity>> {
  const res = await api.post('/api/lottery/admin/activities', data)
  return res.data
}

export async function updateActivity(
  id: number,
  data: LotteryActivityPayload
): Promise<ApiResponse> {
  const res = await api.put(`/api/lottery/admin/activities/${id}`, data)
  return res.data
}

export async function deleteActivity(id: number): Promise<ApiResponse> {
  const res = await api.delete(`/api/lottery/admin/activities/${id}`)
  return res.data
}

export async function cancelActivity(id: number): Promise<ApiResponse> {
  const res = await api.post(`/api/lottery/admin/activities/${id}/cancel`)
  return res.data
}

export async function drawActivity(id: number): Promise<ApiResponse> {
  const res = await api.post(`/api/lottery/admin/activities/${id}/draw`)
  return res.data
}

export async function getActivityEntries(
  id: number,
  page: number,
  pageSize: number,
  winnersOnly: boolean
): Promise<ApiResponse<LotteryEntryPage>> {
  const res = await api.get(`/api/lottery/admin/activities/${id}/entries`, {
    params: { p: page, page_size: pageSize, winners: winnersOnly },
  })
  return res.data
}

export async function deliverEntry(
  id: number,
  note = ''
): Promise<ApiResponse> {
  const res = await api.post(`/api/lottery/admin/entries/${id}/deliver`, {
    note,
  })
  return res.data
}

/** Excludes a locked leaderboard entry from the prizes, or lets it back in. */
export async function setEntryDisqualified(
  id: number,
  disqualified: boolean
): Promise<ApiResponse> {
  const res = await api.post(`/api/lottery/admin/entries/${id}/disqualify`, {
    disqualified,
  })
  return res.data
}
