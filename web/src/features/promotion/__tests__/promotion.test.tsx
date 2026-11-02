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
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createInstance } from 'i18next'
import { I18nextProvider, initReactI18next } from 'react-i18next'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { AffiliateRebatesData } from '@/features/wallet/types'
import { api } from '@/lib/api'

import { Promotion } from '../index'
import type { AffiliateLeaderboard, InviteePage, PromotionTab } from '../types'

const leaderboard: AffiliateLeaderboard = {
  rows: [
    {
      rank: 1,
      name: 'b*b',
      is_me: false,
      total_quota: 2_000_000,
      month_quota: 500_000,
      quarter_quota: 1_500_000,
      paying_invites: 4,
    },
    {
      rank: 2,
      name: 'a***e',
      is_me: true,
      total_quota: 1_000_000,
      month_quota: 500_000,
      quarter_quota: 1_000_000,
      paying_invites: 2,
    },
  ],
  me: {
    rank: 2,
    total_quota: 1_000_000,
    month_quota: 500_000,
    quarter_quota: 1_000_000,
    paying_invites: 2,
  },
}

const invitees: InviteePage = {
  total: 2,
  items: [
    {
      invitee_id: 21,
      name: 'd****x',
      created_at: 1_700_000_000,
      cancelled: true,
      cancelled_at: 1_700_100_000,
      cancel_reason: 'Inviter and invitee logged in from the same IP',
      confirmed_quota: 500_000,
      pending_quota: 0,
    },
    {
      invitee_id: 20,
      name: 'c***l',
      created_at: 1_699_000_000,
      cancelled: false,
      cancelled_at: 0,
      cancel_reason: '',
      confirmed_quota: 500_000,
      pending_quota: 250_000,
    },
  ],
}

const rebates: AffiliateRebatesData = {
  enabled: true,
  rate_percent: 10,
  confirm_days: 7,
  pending_quota: 250_000,
  page: {
    page: 1,
    page_size: 10,
    total: 2,
    items: [
      {
        id: 2,
        invitee_id: 21,
        invitee_name: 'd****x',
        source: 'topup',
        base_quota: 700_000,
        rate_bps: 1000,
        quota: 70_000,
        status: 'rejected',
        reason: 'The invitation has been cancelled',
        confirm_at: 1_700_000_000,
        confirmed_at: 0,
        created_at: 1_699_000_000,
      },
      {
        id: 1,
        invitee_id: 20,
        invitee_name: 'c***l',
        source: 'subscription',
        base_quota: 2_500_000,
        rate_bps: 1000,
        quota: 250_000,
        status: 'pending',
        reason: '',
        confirm_at: 1_700_000_000,
        confirmed_at: 0,
        created_at: 1_699_000_000,
      },
    ],
  },
}

function mockApi(overrides: {
  leaderboard?: AffiliateLeaderboard
  rebates?: AffiliateRebatesData
}) {
  const responses: Record<string, unknown> = {
    '/api/user/aff': 'abc',
    '/api/user/aff/leaderboard': overrides.leaderboard ?? leaderboard,
    '/api/user/aff/invitees': invitees,
    '/api/user/aff/rebates': overrides.rebates ?? rebates,
  }
  vi.spyOn(api, 'get').mockImplementation(async (url: string) => {
    if (!(url in responses)) throw new Error(`unexpected request ${url}`)
    return { data: { success: true, data: responses[url] } }
  })
}

const i18n = createInstance()

beforeEach(async () => {
  // No resources: keys render as written, with values interpolated.
  await i18n.use(initReactI18next).init({
    lng: 'en',
    resources: {},
    nsSeparator: false,
    keySeparator: false,
    interpolation: { escapeValue: false },
  })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

function renderPage(tab: PromotionTab, onTabChange = vi.fn()) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={client}>
        <Promotion tab={tab} onTabChange={onTabChange} />
      </QueryClientProvider>
    </I18nextProvider>
  )
  return onTabChange
}

async function findRowWithText(text: string) {
  const row = (await screen.findByText(text)).closest('tr')
  if (!row) throw new Error(`no table row contains ${text}`)
  return row
}

async function findLeaderboardRows() {
  const table = (await screen.findByText('b*b')).closest('table')
  if (!table) throw new Error('leaderboard table not found')
  return within(table).getAllByRole('row').slice(1)
}

describe('promotion center', () => {
  it('the leaderboard lists masked inviters and marks the caller row', async () => {
    mockApi({})
    renderPage('invitees')

    const rows = await findLeaderboardRows()

    expect(rows).toHaveLength(2)
    expect(rows[0]).toHaveTextContent('b*b')
    expect(rows[0]).not.toHaveAttribute('aria-current')
    expect(rows[1]).toHaveTextContent('a***e')
    expect(rows[1]).toHaveAttribute('aria-current', 'true')
    expect(within(rows[1]).getByText('You')).toBeVisible()
    expect(screen.getByText('My rank').nextElementSibling).toHaveTextContent(
      /^2$/
    )
  })

  it('a caller outside the listed ranks sees that they are not ranked', async () => {
    mockApi({
      leaderboard: {
        rows: [leaderboard.rows[0]],
        me: {
          rank: 0,
          total_quota: 0,
          month_quota: 0,
          quarter_quota: 0,
          paying_invites: 0,
        },
      },
    })
    renderPage('invitees')

    await findLeaderboardRows()

    expect(screen.getByText('My rank').nextElementSibling).toHaveTextContent(
      'Not ranked'
    )
    expect(screen.queryByText('You')).not.toBeInTheDocument()
  })

  it('the invitees tab lists cancelled invitations with their reason next to active ones', async () => {
    mockApi({})
    renderPage('invitees')

    const cancelled = await findRowWithText('d****x')
    const active = await findRowWithText('c***l')

    expect(within(cancelled).getByText('Cancelled')).toBeVisible()
    expect(
      within(cancelled).getByText(
        'Inviter and invitee logged in from the same IP'
      )
    ).toBeVisible()
    expect(within(active).getByText('Invitation active')).toBeVisible()
    expect(api.get).toHaveBeenCalledWith('/api/user/aff/invitees', {
      params: { p: 1, page_size: 10 },
      signal: expect.any(AbortSignal),
    })
  })

  it('choosing the rebate orders tab reports the tab change', async () => {
    mockApi({})
    const onTabChange = renderPage('invitees')

    await userEvent.click(
      await screen.findByRole('tab', { name: 'Rebate orders' })
    )

    expect(onTabChange).toHaveBeenCalledWith('rebates')
  })

  it('the rebate orders tab shows each order status with the masked invitee', async () => {
    mockApi({})
    renderPage('rebates')

    const rejected = await findRowWithText('Rejected')
    const pending = await findRowWithText('Confirming')

    expect(rejected).toHaveTextContent('d****x')
    expect(rejected).toHaveTextContent('The invitation has been cancelled')
    expect(pending).toHaveTextContent('c***l')
    expect(api.get).not.toHaveBeenCalledWith(
      '/api/user/aff/invitees',
      expect.anything()
    )
  })

  it('a rejected rebate shows no confirmation time while a confirming one shows when it will credit', async () => {
    mockApi({})
    renderPage('rebates')

    const rejected = await findRowWithText('Rejected')
    const pending = await findRowWithText('Confirming')

    expect(rejected.querySelector('time')).toBeNull()
    expect(pending.querySelector('time')).toHaveAttribute(
      'datetime',
      new Date(1_700_000_000_000).toISOString()
    )
  })

  it('with rebates disabled the page says so instead of the rebate rule', async () => {
    mockApi({ rebates: { ...rebates, enabled: false } })
    renderPage('invitees')

    expect(
      await screen.findByText('Referral rebates are not enabled.')
    ).toBeVisible()
  })
})
