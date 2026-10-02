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
import { afterEach, describe, expect, test, vi } from 'vitest'

import { SettingsPageProvider } from '@/features/system-settings/components/settings-page-context'
import { api } from '@/lib/api'

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
          grants: [{ id: 1, remaining: 500000, quota: 1000000, expires_at: 0 }],
          records: [],
        },
      },
    })
    mount(<TrialBalanceCard />)
    expect(await screen.findByText('Never expires')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled()
    expect(screen.getByText(/Trial group: trial/)).toBeInTheDocument()
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
      await userEvent.clear(screen.getByRole('spinbutton'))
      await userEvent.type(screen.getByRole('spinbutton'), '7')
      await userEvent.click(screen.getByRole('button', { name: 'Save' }))
      await waitFor(() =>
        expect(put).toHaveBeenCalledWith('/api/trial-credit/config', {
          enabled: true,
          group: 'trial',
          affiliate: true,
          affiliate_days: 7,
        })
      )
    } finally {
      actions.remove()
    }
  })
})
