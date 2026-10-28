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
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { api, type ApiRequestConfig } from '@/lib/api'
import { Route } from '@/routes/_authenticated/referrals'
import { useAuthStore } from '@/stores/auth-store'

import { referralsSearchSchema, type ReferralsSearch } from '../api'
import { ReferralsPage } from '../index'
import type {
  AffiliateInvite,
  AffiliateInviteLog,
  AffiliateRebate,
} from '../types'

const invite: AffiliateInvite = {
  invitee_id: 21,
  invitee_username: 'invitee-user',
  invitee_status: 1,
  created_at: 1_700_000_000,
  inviter_id: 7,
  inviter_username: 'inviter-user',
  risk_score: {
    score: 30,
    shared_ip_users: 1,
    same_subnet_users: 0,
    ip_count: 2,
    updated_at: 1_700_000_000,
  },
  confirmed_quota: 500_000,
  pending_quota: 250_000,
}
const rebate: AffiliateRebate = {
  id: 5,
  inviter_id: 7,
  inviter_username: 'inviter-user',
  invitee_id: 21,
  invitee_username: 'invitee-user',
  trade_no: 'trade-review',
  source: 'topup',
  base_quota: 5_000_000,
  rate_bps: 1000,
  quota: 500_000,
  status: 'review',
  confirm_at: 1_700_000_000,
  reason: 'Invitee risk score is too high',
  risk_score: 80,
  reviewed_by: 0,
  reviewer_username: '',
  review_note: '',
  confirmed_at: 0,
  created_at: 1_699_000_000,
}
const log: AffiliateInviteLog = {
  id: 9,
  invitee_id: 21,
  invitee_username: 'invitee-user',
  inviter_id: 7,
  inviter_username: 'inviter-user',
  action: 'cancel',
  reason: 'Inviter and invitee logged in from the same IP',
  shared_ips: '203.0.113.1,203.0.113.2',
  operator_id: 0,
  operator_username: '',
  note: '',
  created_at: 1_700_000_000,
  restorable: true,
}

type Request = { url: string; params: Record<string, unknown> }
let requests: Request[]
let rebates: AffiliateRebate[]
let logs: AffiliateInviteLog[]
let postError: string | null
let total: number | undefined
let client: QueryClient

beforeEach(() => {
  localStorage.clear()
  requests = []
  rebates = [
    { ...rebate },
    {
      ...rebate,
      id: 6,
      status: 'pending',
      reason: '',
      risk_score: 0,
      trade_no: 'trade-pending',
    },
  ]
  logs = [log]
  postError = null
  total = undefined
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  vi.spyOn(api, 'get').mockImplementation(
    async (url, config?: ApiRequestConfig) => {
      requests.push({ url, params: config?.params ?? {} })
      const page = <T,>(items: T[]) => ({
        data: { success: true, data: { items, total: total ?? items.length } },
      })
      if (url === '/api/affiliate/summary') {
        return {
          data: {
            success: true,
            data: {
              active_invites: 12,
              cancelled_invites: 3,
              pending_quota: 250_000,
              review_count: 4,
            },
          },
        }
      }
      if (url === '/api/affiliate/invites') return page([invite])
      if (url === '/api/affiliate/rebates') return page(rebates)
      if (url === '/api/affiliate/invite-logs') return page(logs)
      throw new Error(`Unexpected endpoint: ${url}`)
    }
  )
  vi.spyOn(api, 'post').mockImplementation(async () => {
    if (postError) return { data: { success: false, message: postError } }
    return { data: { success: true } }
  })
})
afterEach(() => {
  client.clear()
  localStorage.clear()
  useAuthStore.getState().auth.setUser(null)
})

function ReferralsHarness(props: { initial?: ReferralsSearch }) {
  const [search, setSearch] = useState<ReferralsSearch>(props.initial ?? {})
  return (
    <QueryClientProvider client={client}>
      <output aria-label='URL search'>{JSON.stringify(search)}</output>
      <ReferralsPage
        search={search}
        navigate={({ search: next }) =>
          setSearch((prev) => {
            if (next === true) return prev
            return referralsSearchSchema.parse(
              typeof next === 'function' ? next(prev) : next
            )
          })
        }
      />
    </QueryClientProvider>
  )
}

const lastRequest = (url: string) =>
  [...requests].reverse().find((request) => request.url === url)?.params

it('restores invitation filters from the URL and sends typed filters from page one', async () => {
  total = 60
  render(
    <ReferralsHarness initial={{ keyword: 'invitee', user_id: 7, page: 2 }} />
  )
  expect(await screen.findByText('invitee-user')).toBeVisible()
  expect(lastRequest('/api/affiliate/invites')).toMatchObject({
    keyword: 'invitee',
    user_id: 7,
    p: 2,
  })
  const user = userEvent.setup()
  const userId = screen.getByRole('textbox', { name: 'User ID' })
  await user.clear(userId)
  await user.type(userId, '21x')
  expect(userId).toHaveValue('21')
  await waitFor(() =>
    expect(lastRequest('/api/affiliate/invites')).toMatchObject({
      user_id: 21,
      keyword: 'invitee',
      p: 1,
    })
  )
  expect(screen.getByText('12')).toBeVisible()
})

it('rebate status and log action filters reach their endpoints, and switching tabs clears filters', async () => {
  const user = userEvent.setup()
  render(<ReferralsHarness initial={{ tab: 'rebates', user_id: 7 }} />)
  expect(await screen.findByText('trade-review')).toBeVisible()
  await user.click(screen.getByRole('combobox', { name: 'Status' }))
  await user.click(await screen.findByRole('option', { name: 'Under review' }))
  await waitFor(() =>
    expect(lastRequest('/api/affiliate/rebates')).toMatchObject({
      status: 'review',
      user_id: 7,
      p: 1,
    })
  )

  await user.click(screen.getByRole('tab', { name: 'Invitation logs' }))
  expect(await screen.findByText('203.0.113.1, 203.0.113.2')).toBeVisible()
  expect(lastRequest('/api/affiliate/invite-logs')).toMatchObject({
    user_id: undefined,
    action: undefined,
  })
  expect(screen.getByText('System')).toBeVisible()
  expect(
    screen.getByText('Inviter and invitee logged in from the same IP')
  ).toBeVisible()
  await user.click(screen.getByRole('combobox', { name: 'Action' }))
  await user.click(await screen.findByRole('option', { name: 'Restored' }))
  await waitFor(() =>
    expect(lastRequest('/api/affiliate/invite-logs')).toMatchObject({
      action: 'restore',
      p: 1,
    })
  )
})

it('offers restore only on a cancellation that is still in effect', async () => {
  logs = [
    { ...log, id: 11, action: 'restore', reason: '', restorable: false },
    log,
    { ...log, id: 8, invitee_id: 22, restorable: false },
  ]
  render(<ReferralsHarness initial={{ tab: 'logs' }} />)
  await screen.findAllByText('invitee-user')
  expect(screen.getAllByRole('button', { name: 'Restore' })).toHaveLength(1)
})

it('only rebates under review can be approved, while pending ones can still be rejected', async () => {
  render(<ReferralsHarness initial={{ tab: 'rebates' }} />)
  await screen.findByText('trade-review')
  expect(screen.getAllByRole('button', { name: 'Approve' })).toHaveLength(1)
  expect(screen.getAllByRole('button', { name: 'Reject' })).toHaveLength(2)
  expect(screen.getByText(/Invitee risk score is too high/)).toBeVisible()
})

it.each([
  [
    'cancelling an invitation',
    {},
    'Cancel invitation',
    '/api/affiliate/invites/21/cancel',
  ],
  [
    'restoring an invitation',
    { tab: 'logs' as const },
    'Restore',
    '/api/affiliate/invite-logs/9/restore',
  ],
  [
    'approving a rebate',
    { tab: 'rebates' as const },
    'Approve',
    '/api/affiliate/rebates/5/approve',
  ],
  [
    'rejecting a rebate',
    { tab: 'rebates' as const },
    'Reject',
    '/api/affiliate/rebates/5/reject',
  ],
])(
  '%s sends the trimmed note, keeps failures for retry and refreshes the lists',
  async (_, initial, actionName, endpoint) => {
    const user = userEvent.setup()
    render(<ReferralsHarness initial={initial} />)
    const [button] = await screen.findAllByRole('button', { name: actionName })
    await user.click(button)
    const dialog = await screen.findByRole('alertdialog')
    await user.type(
      within(dialog).getByRole('textbox', { name: 'Note (optional)' }),
      '  same household  '
    )
    postError = 'This rebate has already been handled'
    await user.click(within(dialog).getByRole('button', { name: actionName }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'This rebate has already been handled'
    )
    postError = null
    const listRequests = requests.length
    await user.click(within(dialog).getByRole('button', { name: actionName }))
    await waitFor(() =>
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    )
    expect(api.post).toHaveBeenLastCalledWith(endpoint, {
      note: 'same household',
    })
    await waitFor(() => expect(requests.length).toBeGreaterThan(listRequests))
    expect(
      requests.slice(listRequests).map((request) => request.url)
    ).toContain('/api/affiliate/summary')
  }
)

it('a new action starts with an empty note', async () => {
  const user = userEvent.setup()
  render(<ReferralsHarness initial={{ tab: 'rebates' }} />)
  await screen.findByText('trade-review')
  const [reject] = screen.getAllByRole('button', { name: 'Reject' })
  await user.click(reject)
  const dialog = await screen.findByRole('alertdialog')
  await user.type(
    within(dialog).getByRole('textbox', { name: 'Note (optional)' }),
    'draft'
  )
  await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
  await waitFor(() =>
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  )
  await user.click(screen.getAllByRole('button', { name: 'Reject' })[1])
  expect(
    within(await screen.findByRole('alertdialog')).getByRole('textbox', {
      name: 'Note (optional)',
    })
  ).toHaveValue('')
})

it.each([1, 10, 100])(
  'the referrals route permits only admin and root roles (role %s)',
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
