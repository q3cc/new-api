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

import type { TopupRecord } from '@/features/wallet/types'
import { api } from '@/lib/api'
import { requireServerSuccess } from '@/lib/server-error-message'

export const ordersSearchSchema = z.object({
  page: z.number().int().min(1).optional().catch(1),
  pageSize: z.number().int().min(1).max(100).optional().catch(20),
  keyword: z.string().max(255).optional().catch(''),
  order_type: z.enum(['topup', 'subscription']).optional().catch(undefined),
  status: z
    .enum(['pending', 'success', 'failed', 'expired'])
    .optional()
    .catch(undefined),
  payment_method: z.string().max(50).optional().catch(undefined),
  start_timestamp: z
    .number()
    .int()
    .nonnegative()
    .max(253402300799)
    .optional()
    .catch(undefined),
  end_timestamp: z
    .number()
    .int()
    .nonnegative()
    .max(253402300799)
    .optional()
    .catch(undefined),
})
export type OrdersSearch = z.infer<typeof ordersSearchSchema>
export type AdminOrder = TopupRecord & {
  username?: string
  payment_provider?: string
}
export type OrderDetail = AdminOrder & {
  display_name: string
  email: string
  payment_service_id?: string
  payment_service_name?: string
}
type Envelope<T> = { success: boolean; message?: string; data: T }
export async function getOrders(search: OrdersSearch, signal?: AbortSignal) {
  const { page, pageSize, ...filters } = search
  const response = await api.get<
    Envelope<{ items: AdminOrder[]; total: number }>
  >('/api/user/topup', {
    params: { ...filters, p: page ?? 1, page_size: pageSize ?? 20 },
    signal,
  })
  return requireServerSuccess(response.data).data
}
export async function getOrderFilters(signal?: AbortSignal) {
  const response = await api.get<Envelope<{ payment_methods: string[] }>>(
    '/api/user/topup/filters',
    { signal }
  )
  return requireServerSuccess(response.data).data
}
export async function getOrderDetail(order: AdminOrder, signal?: AbortSignal) {
  const response = await api.get<Envelope<OrderDetail>>(
    '/api/user/topup/detail',
    {
      params: {
        order_type: order.order_type ?? 'topup',
        trade_no: order.trade_no,
      },
      signal,
    }
  )
  return requireServerSuccess(response.data).data
}
