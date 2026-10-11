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
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'
import { Route } from '@/routes/_authenticated/orders'
import { useAuthStore } from '@/stores/auth-store'

import { ordersSearchSchema, type AdminOrder, type OrdersSearch } from '../api'
import { OrdersPage } from '../index'

const topup: AdminOrder = {
  id: 1,
  user_id: 12,
  username: 'order-owner',
  amount: 10,
  money: 73,
  trade_no: 'order-topup',
  order_type: 'topup',
  payment_method: 'retired-custom',
  status: 'pending',
  create_time: 100,
}
const subscription: AdminOrder = {
  ...topup,
  id: 1,
  trade_no: 'order-subscription',
  order_type: 'subscription',
  amount: 0,
  plan_id: 8,
  plan_title: 'Monthly plan',
}
let records: AdminOrder[]
let total: number
let listError: boolean
let detailError: boolean
let filtersError: boolean
let completeError: boolean
let requests: OrdersSearch[]
let client: QueryClient

beforeEach(() => {
  localStorage.clear()
  records = [{ ...topup }, { ...subscription }]
  total = 2
  listError = detailError = completeError = filtersError = false
  requests = []
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  vi.spyOn(api, 'get').mockImplementation(async (url, config) => {
    if (url === '/api/user/topup/filters') {
      if (filtersError) throw new Error('Payment methods unavailable')
      return {
        data: { success: true, data: { payment_methods: ['retired-custom'] } },
      }
    }
    if (url === '/api/user/topup/detail') {
      if (detailError) throw new Error('Detail temporarily unavailable')
      const order = records.find(
        (record) => record.trade_no === config?.params.trade_no
      )
      return {
        data: {
          success: true,
          data: {
            ...order,
            display_name: 'Owner nickname',
            email: 'owner@example.com',
            payment_service_name: 'Historical service',
            payment_service_id: 'old-service',
          },
        },
      }
    }
    if (url === '/api/user/topup') {
      requests.push(config?.params)
      if (listError) throw new Error('Orders temporarily unavailable')
      return { data: { success: true, data: { items: records, total } } }
    }
    throw new Error(`Unexpected endpoint: ${url}`)
  })
  vi.spyOn(api, 'post').mockImplementation(async (url, body) => {
    expect(url).toBe('/api/user/topup/complete')
    if (completeError) {
      return {
        data: { success: false, message: 'Payment confirmation failed' },
      }
    }
    const request = body as { trade_no: string }
    records = records.map((record) =>
      record.trade_no === request.trade_no
        ? { ...record, status: 'success' }
        : record
    )
    return { data: { success: true } }
  })
})
afterEach(() => {
  client.clear()
  localStorage.clear()
  useAuthStore.getState().auth.setUser(null)
})

function OrdersHarness(props: { initial?: OrdersSearch }) {
  const [search, setSearch] = useState<OrdersSearch>(props.initial ?? {})
  return (
    <QueryClientProvider client={client}>
      <button
        type='button'
        onClick={() =>
          setSearch({ keyword: 'restored-from-history', page: 2, pageSize: 20 })
        }
      >
        Restore URL
      </button>
      <output aria-label='URL search'>{JSON.stringify(search)}</output>
      <OrdersPage
        search={search}
        navigate={({ search: next }) =>
          setSearch((prev) => {
            if (next === true) return prev
            return ordersSearchSchema.parse(
              typeof next === 'function' ? next(prev) : next
            )
          })
        }
      />
    </QueryClientProvider>
  )
}

it('restores URL filters and pagination, and changing a filter resets to page one', async () => {
  total = 80
  render(
    <OrdersHarness
      initial={{
        keyword: 'owner',
        page: 3,
        pageSize: 20,
        status: 'pending',
        order_type: 'subscription',
        payment_method: 'retired-custom',
        start_timestamp: 100,
        end_timestamp: 200,
      }}
    />
  )
  await screen.findByRole('button', { name: 'order-topup' })
  expect(requests.at(-1)).toMatchObject({
    p: 3,
    page_size: 20,
    keyword: 'owner',
    status: 'pending',
    order_type: 'subscription',
    payment_method: 'retired-custom',
    start_timestamp: 100,
    end_timestamp: 200,
  })
  const user = userEvent.setup()
  await user.click(screen.getByRole('combobox', { name: 'Status' }))
  await user.click(await screen.findByRole('option', { name: 'Success' }))
  await waitFor(() =>
    expect(requests.at(-1)).toMatchObject({
      p: 1,
      status: 'success',
      order_type: 'subscription',
    })
  )
  await user.click(screen.getByRole('button', { name: 'Go to next page' }))
  await waitFor(() =>
    expect(requests.at(-1)).toMatchObject({ p: 2, status: 'success' })
  )
  await user.click(screen.getByRole('button', { name: 'Reset' }))
  await waitFor(() =>
    expect(requests.at(-1)).toMatchObject({ p: 1, page_size: 20, keyword: '' })
  )
  expect(screen.getByLabelText('URL search')).not.toHaveTextContent(
    'start_timestamp'
  )
})

it('restoring another URL updates the visible keyword and search request', async () => {
  total = 60
  render(<OrdersHarness initial={{ keyword: 'initial' }} />)
  await screen.findByRole('button', { name: 'order-topup' })
  await userEvent.click(screen.getByRole('button', { name: 'Restore URL' }))
  expect(screen.getByRole('textbox', { name: 'Search orders' })).toHaveValue(
    'restored-from-history'
  )
  await waitFor(() =>
    expect(requests.at(-1)).toMatchObject({
      keyword: 'restored-from-history',
      p: 2,
    })
  )
  fireEvent.change(screen.getByRole('textbox', { name: 'Search orders' }), {
    target: { value: 'order%_!\\' },
  })
  await waitFor(() =>
    expect(requests.at(-1)).toMatchObject({ keyword: 'order%_!\\', p: 1 })
  )
})

it('rejects reversed date ranges before sending an order request', () => {
  render(
    <OrdersHarness initial={{ start_timestamp: 200, end_timestamp: 100 }} />
  )
  expect(screen.getByRole('alert')).toHaveTextContent(
    'Start time must not be after end time'
  )
  expect(screen.getByRole('button', { name: 'Refresh' })).toBeDisabled()
  expect(requests).toHaveLength(0)
})

it('historical payment options can be retried independently of the order list', async () => {
  filtersError = true
  render(<OrdersHarness />)
  await screen.findByRole('button', { name: 'order-topup' })
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Payment methods unavailable'
  )
  filtersError = false
  await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
  await waitFor(() =>
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  )
  await userEvent.click(
    screen.getByRole('combobox', { name: 'Payment Method' })
  )
  await userEvent.click(
    await screen.findByRole('option', { name: 'retired-custom' })
  )
  await waitFor(() =>
    expect(requests.at(-1)).toMatchObject({
      payment_method: 'retired-custom',
      p: 1,
    })
  )
})

it('keeps the toolbar and allows retry after a list failure, then shows the empty state', async () => {
  listError = true
  render(<OrdersHarness />)
  expect(
    await screen.findByText('Orders temporarily unavailable')
  ).toBeVisible()
  expect(screen.getByRole('textbox', { name: 'Search orders' })).toBeVisible()
  listError = false
  records = []
  total = 0
  await userEvent.click(screen.getByRole('button', { name: /Retry/i }))
  expect(await screen.findByText('No billing records found')).toBeVisible()
})

it('loads fresh details and retries inside the dialog after failure', async () => {
  render(<OrdersHarness />)
  await screen.findByRole('button', { name: 'order-topup' })
  detailError = true
  await userEvent.click(screen.getByRole('button', { name: 'order-topup' }))
  const dialog = await screen.findByRole('dialog', { name: 'Order details' })
  expect(
    await within(dialog).findByText('Detail temporarily unavailable')
  ).toBeVisible()
  detailError = false
  records[0] = { ...records[0], status: 'success', complete_time: 300 }
  await userEvent.click(within(dialog).getByRole('button', { name: /Retry/i }))
  expect(
    await within(dialog).findByText('Historical service (old-service)')
  ).toBeVisible()
  expect(within(dialog).getByText('owner@example.com')).toBeVisible()
  expect(
    within(dialog).queryByRole('button', { name: 'Complete Order' })
  ).not.toBeInTheDocument()
})

it.each([
  [
    'order-topup',
    'Complete this order and credit the corresponding balance to the user?',
  ],
  [
    'order-subscription',
    'Complete this order and activate the subscription plan for the user?',
  ],
])(
  'completing %s preserves failures for retry and refreshes the detail after success',
  async (trade, confirmation) => {
    render(<OrdersHarness />)
    await userEvent.click(await screen.findByRole('button', { name: trade }))
    const detail = await screen.findByRole('dialog', { name: 'Order details' })
    await userEvent.click(
      await within(detail).findByRole('button', { name: 'Complete Order' })
    )
    const confirm = await screen.findByRole('alertdialog', {
      name: 'Complete Order',
    })
    expect(within(confirm).getByText(confirmation)).toBeVisible()
    completeError = true
    await userEvent.click(
      within(confirm).getByRole('button', { name: 'Confirm' })
    )
    expect(await within(confirm).findByRole('alert')).toHaveTextContent(
      'Payment confirmation failed'
    )
    expect(within(confirm).getByText(trade)).toBeVisible()
    completeError = false
    await userEvent.click(
      within(confirm).getByRole('button', { name: 'Confirm' })
    )
    await waitFor(() =>
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    )
    await waitFor(() =>
      expect(
        within(detail).queryByRole('button', { name: 'Complete Order' })
      ).not.toBeInTheDocument()
    )
    expect(api.post).toHaveBeenLastCalledWith('/api/user/topup/complete', {
      trade_no: trade,
    })
  }
)

it('mobile cards retain both order types and expose pending-only actions', async () => {
  const matchMedia = window.matchMedia
  vi.spyOn(window, 'matchMedia').mockImplementation((query) => ({
    ...matchMedia(query),
    matches:
      query.includes('max-width') || query.includes('prefers-reduced-motion'),
  }))
  records[1] = {
    ...subscription,
    status: 'expired',
    plan_title: 'Monthly plan '.repeat(25),
  }
  render(<OrdersHarness />)
  expect(
    await screen.findByRole('button', { name: 'order-topup' })
  ).toBeVisible()
  expect(
    screen.getByRole('button', { name: 'order-subscription' })
  ).toBeVisible()
  expect(
    screen.getAllByRole('button', { name: 'Complete Order' })
  ).toHaveLength(1)
  expect(screen.queryByRole('table')).not.toBeInTheDocument()
})

it.each([1, 10, 100])(
  'the orders route permits only admin and root roles (role %s)',
  (role) => {
    useAuthStore.getState().auth.setUser({
      id: 12,
      username: 'route-user',
      display_name: 'User',
      role,
    } as Parameters<
      ReturnType<typeof useAuthStore.getState>['auth']['setUser']
    >[0])
    const enter = () => Route.options.beforeLoad?.(undefined as never)
    if (role < 10) expect(enter).toThrow()
    else expect(enter).not.toThrow()
  }
)
