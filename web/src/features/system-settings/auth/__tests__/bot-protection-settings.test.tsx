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
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createInstance, type i18n } from 'i18next'
import { useState } from 'react'
import { I18nextProvider } from 'react-i18next'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import zh from '@/i18n/locales/zh.json'
import { api } from '@/lib/api'

import { SettingsPageProvider } from '../../components/settings-page-context'
import type { UpdateOptionRequest } from '../../types'
import type { BotProtectionOptions } from '../bot-protection-options'
import { BotProtectionSection } from '../bot-protection-section'

const emptyOptions: BotProtectionOptions = {
  TurnstileCheckEnabled: false,
  TurnstileSiteKey: '',
  TurnstileSecretKey: '',
  'human_verification.provider': '',
  'human_verification.geetest_captcha_id': '',
  'human_verification.geetest_secret': '',
  'human_verification.recaptcha_site_key': '',
  'human_verification.recaptcha_secret': '',
}

let testI18n: i18n

function Fixture(props: { defaults: BotProtectionOptions }) {
  const [container, setContainer] = useState<HTMLDivElement | null>(null)
  const [client] = useState(
    () => new QueryClient({ defaultOptions: { mutations: { retry: false } } })
  )

  return (
    <I18nextProvider i18n={testI18n}>
      <QueryClientProvider client={client}>
        <div ref={setContainer} />
        <SettingsPageProvider actionsContainer={container}>
          <BotProtectionSection defaultValues={props.defaults} />
        </SettingsPageProvider>
      </QueryClientProvider>
    </I18nextProvider>
  )
}

async function renderSettings(defaults: BotProtectionOptions = emptyOptions) {
  const route = createRootRoute({
    component: () => <Fixture defaults={defaults} />,
  })
  const router = createRouter({
    routeTree: route,
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })
  await router.load()
  render(<RouterProvider router={router} />)
}

beforeEach(async () => {
  testI18n = createInstance()
  await testI18n.init({
    lng: 'en',
    fallbackLng: 'en',
    resources: { en: { translation: {} }, zh },
    interpolation: { escapeValue: false },
  })
  vi.spyOn(api, 'put').mockResolvedValue({ data: { success: true } })
})

function recordSaves() {
  const saved: [string, string | number | boolean][] = []
  const put = vi.spyOn(api, 'put').mockImplementation(async (_url, body) => {
    const request = body as UpdateOptionRequest
    saved.push([request.key, request.value])
    return { data: { success: true, message: '' } } as never
  })
  return { saved, put }
}

async function chooseProvider(
  user: ReturnType<typeof userEvent.setup>,
  name: string
) {
  await user.click(
    screen.getByRole('combobox', { name: 'Human verification provider' })
  )
  await user.click(await screen.findByRole('option', { name }))
}

describe('Bot Protection settings saves', () => {
  it('saves both keys before enabling Turnstile in one save', async () => {
    const { saved, put } = recordSaves()
    const user = userEvent.setup()
    await renderSettings()
    await chooseProvider(user, 'Cloudflare Turnstile')
    await user.type(
      screen.getByRole('textbox', { name: 'Site Key' }),
      'site-key'
    )
    await user.type(screen.getByLabelText('Secret Key'), 'secret-key')
    await user.click(screen.getByRole('button', { name: 'Save Changes' }))

    await waitFor(() => expect(put).toHaveBeenCalledTimes(3))
    expect(saved).toEqual([
      ['TurnstileSiteKey', 'site-key'],
      ['TurnstileSecretKey', 'secret-key'],
      ['TurnstileCheckEnabled', true],
    ])
  })

  it('turns Turnstile off before saving and enabling GeeTest', async () => {
    const { saved, put } = recordSaves()
    const user = userEvent.setup()
    await renderSettings({
      ...emptyOptions,
      TurnstileCheckEnabled: true,
      TurnstileSiteKey: 'turnstile-site',
    })
    await chooseProvider(user, 'GeeTest v4')
    await user.type(
      screen.getByRole('textbox', { name: 'GeeTest ID' }),
      'geetest-id'
    )
    await user.type(screen.getByLabelText('GeeTest KEY'), 'geetest-key')
    await user.click(screen.getByRole('button', { name: 'Save Changes' }))

    await waitFor(() => expect(put).toHaveBeenCalledTimes(4))
    expect(saved).toEqual([
      ['TurnstileCheckEnabled', false],
      ['human_verification.geetest_captcha_id', 'geetest-id'],
      ['human_verification.geetest_secret', 'geetest-key'],
      ['human_verification.provider', 'geetest'],
    ])
  })

  it('keeps the saved reCAPTCHA secret when its field is left empty', async () => {
    const { saved, put } = recordSaves()
    const user = userEvent.setup()
    await renderSettings({
      ...emptyOptions,
      'human_verification.provider': 'recaptcha',
      'human_verification.recaptcha_site_key': 'old-site',
    })
    const siteKey = screen.getByRole('textbox', { name: 'Site Key' })
    await user.clear(siteKey)
    await user.type(siteKey, 'new-site')
    await user.click(screen.getByRole('button', { name: 'Save Changes' }))

    await waitFor(() => expect(put).toHaveBeenCalledTimes(1))
    expect(saved).toEqual([
      ['human_verification.recaptcha_site_key', 'new-site'],
    ])
  })

  it('turns the active provider off without touching its keys', async () => {
    const { saved, put } = recordSaves()
    const user = userEvent.setup()
    await renderSettings({
      ...emptyOptions,
      'human_verification.provider': 'geetest',
      'human_verification.geetest_captcha_id': 'geetest-id',
    })
    await chooseProvider(user, 'Off')
    await user.click(screen.getByRole('button', { name: 'Save Changes' }))

    await waitFor(() => expect(put).toHaveBeenCalledTimes(1))
    expect(saved).toEqual([['human_verification.provider', '']])
  })
})
