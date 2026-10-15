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
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import { SettingsPageProvider } from '@/features/system-settings/components/settings-page-context'
import { api } from '@/lib/api'
import { useSystemConfigStore } from '@/stores/system-config-store'

import { TrialBalanceCard } from '../balance-card'
import { TrialGrantDialog } from '../grant-dialog'
import { TrialCreditSettings } from '../settings'

function mount(node: ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>{node}</QueryClientProvider>
  )
}
beforeEach(() => {
  vi.spyOn(api, 'get').mockResolvedValue({
    data: {
      success: true,
      data: [{ id: 1, name: 'Ds credit', group: 'default', enabled: true }],
    },
  })
})
afterEach(() => vi.restoreAllMocks())
describe('trial credit', () => {
  test('disabled feature without grants stays hidden', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({
      data: {
        success: true,
        data: { enabled: false, balance: 0, total: 0, grants: [], records: [] },
      },
    })
    const view = mount(<TrialBalanceCard />)
    await waitFor(() => expect(view.container.textContent).toBe(''))
  })
  test('shows independent balance and permanent expiry', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({
      data: {
        success: true,
        data: {
          enabled: true,
          group: 'trial',
          balance: 500000,
          total: 1,
          grants: [
            {
              id: 1,
              type_id: 1,
              type_name: 'Trial credit',
              group: 'trial',
              source: 'admin',
              remaining: 500000,
              quota: 1000000,
              expires_at: 0,
            },
          ],
          records: [],
        },
      },
    })
    mount(<TrialBalanceCard />)
    expect(await screen.findByText('Never expires')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Next page' })).toBeDisabled()
    expect(screen.getByText('1 · Trial credit · trial')).toBeInTheDocument()
  })
  test('server failure displays retry and retry restores balance', async () => {
    vi.spyOn(api, 'get')
      .mockRejectedValueOnce(new Error('unavailable'))
      .mockResolvedValue({
        data: {
          success: true,
          data: {
            enabled: true,
            group: 'trial',
            balance: 0,
            total: 0,
            grants: [],
            records: [],
          },
        },
      })
    mount(<TrialBalanceCard />)
    await userEvent.click(await screen.findByRole('button', { name: 'Retry' }))
    expect(await screen.findByText('No records')).toBeInTheDocument()
  })
  test('grant sends quota with an idempotency key and closes only on success', async () => {
    const post = vi
      .spyOn(api, 'post')
      .mockResolvedValue({ data: { success: true } })
    const onOpenChange = vi.fn()
    mount(<TrialGrantDialog userId={17} open onOpenChange={onOpenChange} />)
    await userEvent.clear(screen.getByRole('spinbutton'))
    await userEvent.type(screen.getByRole('spinbutton'), '2')
    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
    expect(post).toHaveBeenCalledWith(
      '/api/user/17/trial-credit',
      expect.objectContaining({
        quota: 1000000,
        expires_at: 0,
        request_id: expect.any(String),
      })
    )
  })
  test('zero grant is rejected before any request', async () => {
    const post = vi.spyOn(api, 'post')
    mount(<TrialGrantDialog userId={17} open onOpenChange={() => {}} />)
    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    await waitFor(() =>
      expect(screen.getByRole('spinbutton')).toHaveAttribute(
        'aria-invalid',
        'true'
      )
    )
    expect(post).not.toHaveBeenCalled()
  })
  test('failed grant keeps the dialog open and reuses its request ID', async () => {
    const post = vi
      .spyOn(api, 'post')
      .mockRejectedValueOnce(new Error('unavailable'))
      .mockResolvedValue({ data: { success: true } })
    const closed = vi.fn()
    mount(<TrialGrantDialog userId={17} open onOpenChange={closed} />)
    await userEvent.clear(screen.getByRole('spinbutton'))
    await userEvent.type(screen.getByRole('spinbutton'), '1')
    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Confirm' })).toBeEnabled()
    )
    expect(closed).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    await waitFor(() => expect(closed).toHaveBeenCalledWith(false))
    expect(post.mock.calls[0][1]).toEqual(post.mock.calls[1][1])
  })
  test('saves AFF trial rewards and validity together', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({
      data: {
        success: true,
        data: {
          enabled: true,
          group: 'trial',
          affiliate: false,
          affiliate_days: 0,
        },
      },
    })
    const put = vi
      .spyOn(api, 'put')
      .mockResolvedValue({ data: { success: true } })
    const actions = document.createElement('div')
    document.body.append(actions)
    try {
      mount(
        <SettingsPageProvider actionsContainer={actions}>
          <TrialCreditSettings groups={['trial', 'default']} />
        </SettingsPageProvider>
      )
      await userEvent.click(
        await screen.findByRole('switch', {
          name: 'AFF rewards as trial credit',
        })
      )
      const validity = screen.getByRole('spinbutton', {
        name: 'Validity (days, 0 = never expires)',
      })
      await userEvent.clear(validity)
      await userEvent.type(validity, '7')
      const threshold = screen.getByRole('spinbutton', {
        name: 'Waive shortfall below (USD)',
      })
      await userEvent.type(threshold, '1.5')
      await userEvent.click(screen.getByRole('button', { name: 'Save' }))
      await waitFor(() =>
        expect(put).toHaveBeenCalledWith(
          '/api/trial-credit/config',
          expect.objectContaining({
            enabled: true,
            group: 'trial',
            affiliate: true,
            affiliate_days: 7,
            affiliate_type_id: 1,
            waive_threshold: 1.5,
          })
        )
      )
    } finally {
      actions.remove()
    }
  })
  test('names the waiver threshold in the site display currency', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({
      data: {
        success: true,
        data: {
          enabled: true,
          group: 'trial',
          affiliate: false,
          affiliate_days: 0,
        },
      },
    })
    const actions = document.createElement('div')
    document.body.append(actions)
    try {
      for (const [display, label] of [
        ['USD', 'Waive shortfall below (USD)'],
        ['CNY', 'Waive shortfall below (CNY)'],
        ['CUSTOM', 'Waive shortfall below (€)'],
        ['TOKENS', 'Waive shortfall below (Tokens)'],
      ] as const) {
        useSystemConfigStore.getState().setConfig({
          currency: {
            ...useSystemConfigStore.getState().config.currency,
            quotaDisplayType: display,
            customCurrencySymbol: '€',
          },
        })
        const view = mount(
          <SettingsPageProvider actionsContainer={actions}>
            <TrialCreditSettings groups={['trial', 'default']} />
          </SettingsPageProvider>
        )
        expect(
          await screen.findByRole('spinbutton', { name: label })
        ).toBeInTheDocument()
        view.unmount()
      }
    } finally {
      useSystemConfigStore.setState(
        useSystemConfigStore.getInitialState(),
        true
      )
      actions.remove()
    }
  })
})

describe('multiple trial credit kinds', () => {
  const kinds = [
    { id: 1, name: 'Ds credit', group: 'Ds', enabled: true },
    { id: 2, name: 'Gpt credit', group: 'Gpt', enabled: true },
  ]
  test('wallet displays separate grants and groups', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({
      data: {
        success: true,
        data: {
          enabled: true,
          balance: 1500000,
          total: 2,
          grants: [
            {
              id: 1,
              type_id: 1,
              type_name: 'Ds credit',
              group: 'Ds',
              source: 'admin',
              quota: 500000,
              remaining: 500000,
              expires_at: 0,
            },
            {
              id: 2,
              type_id: 2,
              type_name: 'Gpt credit',
              group: 'Gpt',
              source: 'admin',
              quota: 1000000,
              remaining: 1000000,
              expires_at: 0,
            },
          ],
          records: [],
          balances: [
            { type_id: 1, name: 'Ds credit', group: 'Ds', balance: 500000 },
            { type_id: 2, name: 'Gpt credit', group: 'Gpt', balance: 1000000 },
          ],
        },
      },
    })
    mount(<TrialBalanceCard />)
    expect(await screen.findByText('1 · Ds credit · Ds')).toBeInTheDocument()
    expect(screen.getByText('2 · Gpt credit · Gpt')).toBeInTheDocument()
    expect(screen.getAllByRole('progressbar')).toHaveLength(2)
  })
  test('administrator must choose a kind when several are available', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({
      data: { success: true, data: kinds },
    })
    const post = vi.spyOn(api, 'post')
    mount(<TrialGrantDialog userId={17} open onOpenChange={() => {}} />)
    await userEvent.type(screen.getByRole('spinbutton'), '2')
    await waitFor(() =>
      expect(
        screen.getByRole('combobox', { name: 'Trial credit kind' })
      ).toBeEnabled()
    )
    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    await waitFor(() =>
      expect(
        screen.getByRole('combobox', { name: 'Trial credit kind' })
      ).toHaveAttribute('aria-invalid', 'true')
    )
    expect(post).not.toHaveBeenCalled()
  })
  test('administrator selecting Gpt sends its ID with the custom amount', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({
      data: { success: true, data: kinds },
    })
    const post = vi
      .spyOn(api, 'post')
      .mockResolvedValue({ data: { success: true } })
    const closed = vi.fn()
    mount(<TrialGrantDialog userId={17} open onOpenChange={closed} />)
    const selector = await screen.findByRole('combobox', {
      name: 'Trial credit kind',
    })
    await waitFor(() => expect(selector).toBeEnabled())
    await userEvent.click(selector)
    await userEvent.click(
      await screen.findByRole('option', { name: '2 · Gpt credit · Gpt' })
    )
    await userEvent.type(screen.getByRole('spinbutton'), '2')
    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    await waitFor(() => expect(closed).toHaveBeenCalledWith(false))
    expect(post).toHaveBeenCalledWith(
      '/api/user/17/trial-credit',
      expect.objectContaining({ type_id: 2, quota: 1000000 })
    )
  })
  test('invitation rewards can select the second saved kind', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({
      data: {
        success: true,
        data: {
          enabled: true,
          group: 'Ds',
          affiliate: true,
          affiliate_days: 0,
          affiliate_type_id: 1,
          types: kinds,
        },
      },
    })
    const put = vi
      .spyOn(api, 'put')
      .mockResolvedValue({ data: { success: true } })
    const actions = document.createElement('div')
    document.body.append(actions)
    try {
      mount(
        <SettingsPageProvider actionsContainer={actions}>
          <TrialCreditSettings groups={['Ds', 'Gpt']} />
        </SettingsPageProvider>
      )
      await userEvent.click(
        await screen.findByRole('combobox', { name: 'Invitation reward kind' })
      )
      await userEvent.click(
        await screen.findByRole('option', { name: '2 · Gpt credit · Gpt' })
      )
      await userEvent.click(screen.getByRole('button', { name: 'Save' }))
      await waitFor(() =>
        expect(put).toHaveBeenCalledWith(
          '/api/trial-credit/config',
          expect.objectContaining({ affiliate_type_id: 2, types: kinds })
        )
      )
    } finally {
      actions.remove()
    }
  })
})

test('adding a kind saves its selected group and displays the assigned ID', async () => {
  vi.spyOn(api, 'get').mockResolvedValue({
    data: {
      success: true,
      data: {
        enabled: false,
        group: '',
        affiliate: false,
        affiliate_days: 0,
        affiliate_type_id: 0,
        types: [],
      },
    },
  })
  const put = vi.spyOn(api, 'put').mockResolvedValue({
    data: {
      success: true,
      data: {
        enabled: true,
        group: 'Ds',
        affiliate: false,
        affiliate_days: 0,
        affiliate_type_id: 0,
        types: [{ id: 7, name: 'Ds credit', group: 'Ds', enabled: true }],
      },
    },
  })
  const actions = document.createElement('div')
  document.body.append(actions)
  try {
    mount(
      <SettingsPageProvider actionsContainer={actions}>
        <TrialCreditSettings groups={['Ds', 'Gpt']} />
      </SettingsPageProvider>
    )
    await userEvent.click(
      await screen.findByRole('switch', { name: 'Trial credit' })
    )
    await userEvent.click(
      screen.getByRole('button', { name: 'Add trial credit kind' })
    )
    await userEvent.type(
      screen.getByRole('textbox', { name: 'Trial credit name 1' }),
      'Ds credit'
    )
    await userEvent.click(
      screen.getByRole('combobox', { name: 'Trial group 1' })
    )
    await userEvent.click(await screen.findByRole('option', { name: 'Ds' }))
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(put).toHaveBeenCalledWith(
        '/api/trial-credit/config',
        expect.objectContaining({
          types: [{ id: 0, name: 'Ds credit', group: 'Ds', enabled: true }],
        })
      )
    )
    expect(await screen.findByRole('cell', { name: '7' })).toBeInTheDocument()
  } finally {
    actions.remove()
  }
})
