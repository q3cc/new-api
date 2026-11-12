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
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query'
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import { UpdateCheckerSection } from '@/features/system-settings/maintenance/update-checker-section'
import { api } from '@/lib/api'
import { createAppQueryClient } from '@/lib/query-client'
import { ROLE } from '@/lib/roles'
import { useAuthStore } from '@/stores/auth-store'

import type { OnlineUpgradeStatus } from '../online-upgrade'
import { useSystemUpdatePreferencesStore } from '../store'
import { SystemUpdateAction } from '../system-update-action'

vi.mock('@/features/auth/secure-verification', () => ({
  useSecureVerification: () => ({
    requestVerification: vi.fn(),
    dialogProps: {},
  }),
  SecureVerificationDialog: () => null,
}))

const CURRENT = 'main-20261101-aaaaaaa'
const LATEST = 'main-20261102-bbbbbbb'
const RELEASE_URL = `https://github.com/q3cc/new-api/releases/tag/${LATEST}`

let client: QueryClient
let upgradeStatus: OnlineUpgradeStatus

function adminStatus(
  overrides: Partial<OnlineUpgradeStatus> = {}
): OnlineUpgradeStatus {
  return {
    supervised: false,
    current_version: CURRENT,
    drain_timeout: 7200,
    check: {
      has_update: true,
      checked_at: 1_793_600_000,
      latest: {
        version: LATEST,
        notes: '',
        url: RELEASE_URL,
        published_at: 1_793_590_000,
      },
    },
    progress: { downloaded: 0, total: 0 },
    can_upgrade: false,
    ...overrides,
  }
}

function Wrapper(props: { children: ReactNode }) {
  return (
    <QueryClientProvider client={client}>{props.children}</QueryClientProvider>
  )
}

beforeEach(() => {
  localStorage.clear()
  useSystemUpdatePreferencesStore.setState({ ignoredVersionsByUserId: {} })
  useAuthStore
    .getState()
    .auth.setUser({ id: 1, username: 'admin', role: ROLE.ADMIN })
  upgradeStatus = adminStatus()
  client = createAppQueryClient()
  vi.spyOn(api, 'get').mockImplementation(async (url: string) => {
    if (url === '/api/system-upgrade/status') {
      return { data: { success: true, data: upgradeStatus } }
    }
    return { data: { success: true, data: { version: CURRENT } } }
  })
})

afterEach(() => {
  cleanup()
  client.clear()
  useSystemUpdatePreferencesStore.setState({ ignoredVersionsByUserId: {} })
  useAuthStore.getState().auth.reset()
  localStorage.clear()
  vi.restoreAllMocks()
})

function upgradeStatusRequests() {
  return vi
    .mocked(api.get)
    .mock.calls.filter(([url]) => url === '/api/system-upgrade/status')
}

describe('system update entry', () => {
  test.each([null, ROLE.USER])(
    'is hidden and asks the server nothing for role %s',
    (role) => {
      useAuthStore
        .getState()
        .auth.setUser(role === null ? null : { id: 2, username: 'user', role })
      render(<SystemUpdateAction presentation='version' />, {
        wrapper: Wrapper,
      })
      expect(screen.queryByRole('button')).not.toBeInTheDocument()
      expect(upgradeStatusRequests()).toHaveLength(0)
    }
  )

  test.each([ROLE.ADMIN, ROLE.SUPER_ADMIN])(
    'shows the server-reported update for role %s without asking GitHub from the browser',
    async (role) => {
      const fetchMock = vi.fn()
      vi.stubGlobal('fetch', fetchMock)
      useAuthStore.getState().auth.setUser({ id: 1, username: 'admin', role })
      render(<SystemUpdateAction />, { wrapper: Wrapper })

      expect(
        await screen.findByRole('button', {
          name: `New version available: ${LATEST}`,
        })
      ).toBeInTheDocument()
      expect(fetchMock).not.toHaveBeenCalled()
      vi.unstubAllGlobals()
    }
  )

  test('opens one release check with a link to the release', async () => {
    const user = userEvent.setup()
    render(<SystemUpdateAction presentation='version' />, { wrapper: Wrapper })

    await user.click(
      await screen.findByRole('button', {
        name: new RegExp(`New version available: ${LATEST}`),
      })
    )
    const dialog = await screen.findByRole('dialog', { name: 'System updates' })
    expect(
      await within(dialog).findByText(`New version available: ${LATEST}`)
    ).toBeInTheDocument()
    expect(
      within(dialog).getAllByRole('button', { name: 'Check for updates' })
    ).toHaveLength(1)
    expect(
      within(dialog).getByRole('link', { name: 'Go to GitHub' })
    ).toHaveAttribute('href', RELEASE_URL)
  })

  test('shows no reminder when the server reports no newer version', async () => {
    upgradeStatus = adminStatus({
      check: { has_update: false, checked_at: 1_793_600_000 },
    })
    render(<SystemUpdateAction />, { wrapper: Wrapper })

    await waitFor(() => expect(upgradeStatusRequests()).toHaveLength(1))
    expect(
      await screen.findByRole('button', { name: 'Check for updates' })
    ).toBeInTheDocument()
    expect(screen.queryByText('Update available')).not.toBeInTheDocument()
  })

  test('reports a failed server check in the tooltip', async () => {
    upgradeStatus = adminStatus({
      check: {
        has_update: false,
        checked_at: 1_793_600_000,
        error: 'GitHub rate limit reached; try again later',
      },
    })
    render(<SystemUpdateAction presentation='version' />, { wrapper: Wrapper })

    const trigger = await screen.findByRole('button', {
      name: /Failed to check for updates/,
    })
    expect(within(trigger).getByText(CURRENT)).toBeInTheDocument()
  })
})

describe('ignoring a version', () => {
  test('silences every entry for this administrator and can be restored', async () => {
    const user = userEvent.setup()
    render(
      <>
        <SystemUpdateAction presentation='version' />
        <SystemUpdateAction compact={false} />
      </>,
      { wrapper: Wrapper }
    )
    const triggers = await screen.findAllByRole('button', {
      name: new RegExp(`New version available: ${LATEST}`),
    })
    expect(triggers).toHaveLength(2)

    await user.click(triggers[0])
    const dialog = await screen.findByRole('dialog')
    await user.click(
      within(dialog).getByRole('button', { name: 'Ignore this version' })
    )
    expect(within(dialog).getByText('This version is ignored')).toBeVisible()
    for (const trigger of triggers) {
      expect(trigger).not.toHaveAttribute(
        'title',
        expect.stringContaining('New version available')
      )
    }
    expect(
      JSON.parse(localStorage.getItem('system-update-preferences:v1') ?? '{}')
        .state.ignoredVersionsByUserId
    ).toEqual({ 1: [LATEST] })

    await user.click(
      within(dialog).getByRole('button', { name: 'Restore notifications' })
    )
    expect(
      within(dialog).queryByText('This version is ignored')
    ).not.toBeInTheDocument()
    for (const trigger of triggers) {
      expect(trigger).toHaveAttribute(
        'title',
        expect.stringContaining(`New version available: ${LATEST}`)
      )
    }
  })

  test('applies only to the administrator who ignored it', async () => {
    useSystemUpdatePreferencesStore.setState({
      ignoredVersionsByUserId: { 2: [LATEST] },
    })
    render(<SystemUpdateAction />, { wrapper: Wrapper })

    expect(
      await screen.findByRole('button', {
        name: `New version available: ${LATEST}`,
      })
    ).toBeInTheDocument()
  })

  test('a newer release than the ignored one notifies again', async () => {
    useSystemUpdatePreferencesStore.setState({
      ignoredVersionsByUserId: { 1: ['main-20261101-0000000'] },
    })
    render(<SystemUpdateAction />, { wrapper: Wrapper })

    expect(
      await screen.findByRole('button', {
        name: `New version available: ${LATEST}`,
      })
    ).toBeInTheDocument()
  })
})

describe('system maintenance', () => {
  test('shows the release check once', async () => {
    render(
      <UpdateCheckerSection currentVersion={CURRENT} startTime={1_700_000_000} />,
      { wrapper: Wrapper }
    )

    expect(
      await screen.findByText(`New version available: ${LATEST}`)
    ).toBeInTheDocument()
    expect(
      screen.getAllByRole('button', { name: 'Check for updates' })
    ).toHaveLength(1)
  })
})
