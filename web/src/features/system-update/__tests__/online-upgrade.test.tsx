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
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createInstance } from 'i18next'
import { I18nextProvider, initReactI18next } from 'react-i18next'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'
import { ROLE } from '@/lib/roles'
import { useAuthStore } from '@/stores/auth-store'

import { OnlineUpgradeCard } from '../components/online-upgrade-card'
import type { OnlineUpgradeStatus } from '../online-upgrade'

// The identity check is its own dialog flow; here it simply grants a proof.
const requestVerification = vi.fn()
vi.mock('@/features/auth/secure-verification', () => ({
  useSecureVerification: () => ({ requestVerification, dialogProps: {} }),
  SecureVerificationDialog: () => null,
}))

const LATEST = 'main-20261102-bbbbbbb'

function statusWith(
  overrides: Partial<OnlineUpgradeStatus> = {}
): OnlineUpgradeStatus {
  return {
    supervised: true,
    current_version: 'main-20261101-aaaaaaa',
    drain_timeout: 7200,
    check: {
      has_update: true,
      checked_at: 1_793_600_000,
      latest: {
        version: LATEST,
        notes: '- feat: something new',
        url: `https://github.com/q3cc/new-api/releases/tag/${LATEST}`,
        published_at: 1_793_590_000,
      },
    },
    progress: { downloaded: 0, total: 0 },
    supervisor: { phase: 'idle', draining: [] },
    ...overrides,
  }
}

function mockStatus(status: OnlineUpgradeStatus) {
  vi.spyOn(api, 'get').mockImplementation(async (url: string) => {
    if (url !== '/api/system-upgrade/status') {
      throw new Error(`unexpected request ${url}`)
    }
    return { data: { success: true, data: status } }
  })
}

const i18n = createInstance()

beforeEach(async () => {
  await i18n.use(initReactI18next).init({
    lng: 'en',
    resources: {},
    nsSeparator: false,
    keySeparator: false,
    interpolation: { escapeValue: false },
  })
  useAuthStore
    .getState()
    .auth.setUser({ id: 1, username: 'root', role: ROLE.SUPER_ADMIN })
  requestVerification.mockResolvedValue({ proof_token: 'proof-1' })
})

afterEach(() => {
  cleanup()
  useAuthStore.getState().auth.reset()
  requestVerification.mockReset()
  vi.restoreAllMocks()
})

function renderCard() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={client}>
        <OnlineUpgradeCard />
      </QueryClientProvider>
    </I18nextProvider>
  )
}

describe('online upgrade card', () => {
  it('without the supervisor explains how to enable it and offers no upgrade', async () => {
    mockStatus(statusWith({ supervised: false }))
    renderCard()

    expect(
      await screen.findByText('Online upgrade is not enabled')
    ).toBeVisible()
    expect(screen.getByText(`New version available: ${LATEST}`)).toBeVisible()
    expect(
      screen.queryByRole('button', { name: `Upgrade to ${LATEST}` })
    ).not.toBeInTheDocument()
  })

  it('upgrading verifies identity for that version and sends the proof', async () => {
    mockStatus(statusWith())
    const post = vi
      .spyOn(api, 'post')
      .mockResolvedValue({ data: { success: true, data: null } })
    renderCard()

    await userEvent.click(
      await screen.findByRole('button', { name: `Upgrade to ${LATEST}` })
    )

    await waitFor(() =>
      expect(post).toHaveBeenCalledWith(
        '/api/system-upgrade/apply',
        { version: LATEST },
        { headers: { 'X-Security-Proof': 'proof-1' } }
      )
    )
    expect(requestVerification).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: 'system.upgrade',
        context: { action: 'apply', version: LATEST },
      })
    )
  })

  it('cancelling the identity check sends nothing', async () => {
    mockStatus(statusWith())
    requestVerification.mockResolvedValue(null)
    const post = vi.spyOn(api, 'post')
    renderCard()

    await userEvent.click(
      await screen.findByRole('button', { name: `Upgrade to ${LATEST}` })
    )

    await waitFor(() => expect(requestVerification).toHaveBeenCalled())
    expect(post).not.toHaveBeenCalled()
  })

  it('a download in progress shows its percentage and disables the buttons', async () => {
    mockStatus(
      statusWith({
        progress: {
          phase: 'downloading',
          version: LATEST,
          downloaded: 25,
          total: 100,
        },
        supervisor: {
          phase: 'succeeded',
          draining: [],
          previous: { version: 'main-20261031-0000000' },
        },
      })
    )
    renderCard()

    expect(await screen.findByText(`Downloading ${LATEST}: 25%`)).toBeVisible()
    expect(screen.getByRole('progressbar')).toHaveAttribute(
      'aria-valuenow',
      '25'
    )
    expect(
      screen.getByRole('button', { name: `Upgrade to ${LATEST}` })
    ).toBeDisabled()
    expect(
      screen.getByRole('button', { name: 'Roll back to main-20261031-0000000' })
    ).toBeDisabled()
  })

  it('after the switch it counts the connections the previous version still serves', async () => {
    mockStatus(
      statusWith({
        current_version: LATEST,
        check: { has_update: false, checked_at: 1_793_600_000 },
        supervisor: {
          phase: 'succeeded',
          target_version: LATEST,
          draining: [
            {
              generation: 1,
              pid: 10,
              version: 'main-20261101-aaaaaaa',
              started_at: 1,
              draining_since: 2,
              connections: 3,
            },
          ],
          previous: { version: 'main-20261101-aaaaaaa' },
        },
      })
    )
    renderCard()

    expect(
      await screen.findByText(
        `Now running ${LATEST}. The previous version is finishing 3 open connections and exits when they are done.`
      )
    ).toBeVisible()
    expect(
      screen.getByText('You are running the latest version.')
    ).toBeVisible()
  })

  it('a failed switch shows the reason the supervisor gave', async () => {
    mockStatus(
      statusWith({
        supervisor: {
          phase: 'failed',
          target_version: LATEST,
          error: 'the new version exited before it started serving',
          draining: [],
        },
      })
    )
    renderCard()

    expect(
      await screen.findByText(
        'Upgrade failed: the new version exited before it started serving'
      )
    ).toBeVisible()
  })

  it('rolling back verifies identity for a rollback and sends the proof', async () => {
    mockStatus(
      statusWith({
        check: { has_update: false, checked_at: 1 },
        supervisor: {
          phase: 'succeeded',
          draining: [],
          previous: { version: 'main-20261101-aaaaaaa' },
        },
      })
    )
    const post = vi
      .spyOn(api, 'post')
      .mockResolvedValue({ data: { success: true, data: null } })
    renderCard()

    await userEvent.click(
      await screen.findByRole('button', {
        name: 'Roll back to main-20261101-aaaaaaa',
      })
    )

    await waitFor(() =>
      expect(post).toHaveBeenCalledWith(
        '/api/system-upgrade/rollback',
        {},
        { headers: { 'X-Security-Proof': 'proof-1' } }
      )
    )
    expect(requestVerification).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: 'system.upgrade',
        context: { action: 'rollback' },
      })
    )
  })
})
