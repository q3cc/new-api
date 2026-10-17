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
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import i18next from 'i18next'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { api } from '@/lib/api'
import { useSystemConfigStore } from '@/stores/system-config-store'

import { CinematicHome } from '../components/cinematic-home'
import { ConnectionExample } from '../components/connection-example'

const pricing = {
  success: true,
  data: [
    {
      id: 1,
      model_name: 'example-chat',
      vendor_id: 1,
      context_length: 128000,
      enable_groups: ['default'],
    },
  ],
  vendors: [{ id: 1, name: 'Example AI' }],
  usable_group: { default: { desc: 'Default', ratio: 1 } },
}
let client: QueryClient
const originalConfig = useSystemConfigStore.getState().config
beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  useSystemConfigStore.getState().setConfig({ systemName: 'New API' })
  useSystemConfigStore.getState().setLoading(false)
  vi.spyOn(api, 'get').mockResolvedValue({ data: { success: true, data: '' } })
})
afterEach(async () => {
  client.clear()
  useSystemConfigStore.getState().setConfig(originalConfig)
  await i18next.changeLanguage('en')
})
async function mount(
  options: {
    authenticated?: boolean
    restricted?: boolean
    data?: typeof pricing
    fail?: boolean
  } = {}
) {
  client.setQueryData(['status'], {
    server_address: 'https://gateway.example/proxy/',
    docs_link: 'https://docs.example',
    HeaderNavModules: JSON.stringify({
      pricing: { enabled: true, requireAuth: !!options.restricted },
    }),
  })
  if (!options.fail) client.setQueryData(['pricing'], options.data ?? pricing)
  const root = createRootRoute()
  const route = createRoute({
    getParentRoute: () => root,
    path: '/',
    component: () => (
      <CinematicHome isAuthenticated={!!options.authenticated} />
    ),
  })
  const router = createRouter({
    routeTree: root.addChildren([route]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })
  await router.load()
  return render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  )
}

test('guests can start, explore models, and copy the configured API address', async () => {
  const user = userEvent.setup()
  await mount()
  const main = within(screen.getByRole('main'))
  expect(main.getByRole('heading', { level: 1 })).toHaveTextContent('New API')
  for (const link of main.getAllByRole('link', { name: 'Get Started' })) {
    expect(link).toHaveAttribute('href', '/sign-up')
  }
  expect(main.getByRole('link', { name: /Explore models/ })).toHaveAttribute(
    'href',
    '/pricing'
  )
  expect(main.getByRole('heading', { name: 'example-chat' })).toBeVisible()
  expect(main.getByText(/128K Context/)).toBeVisible()
  await user.click(main.getByRole('button', { name: 'Copy API address' }))
  expect(await navigator.clipboard.readText()).toBe(
    'https://gateway.example/proxy/v1'
  )
  expect(main.getByRole('link', { name: 'Docs' })).toHaveAttribute(
    'href',
    'https://docs.example'
  )
})

test('signed-in users can return to the dashboard and playground', async () => {
  await mount({ authenticated: true })
  const main = within(screen.getByRole('main'))
  expect(main.getByRole('link', { name: /Go to Dashboard/ })).toHaveAttribute(
    'href',
    '/dashboard'
  )
  expect(main.getByRole('link', { name: /Open Playground/ })).toHaveAttribute(
    'href',
    '/playground'
  )
})

test('keyboard tab selection copies the currently selected example, without credentials', async () => {
  const user = userEvent.setup()
  render(<ConnectionExample baseUrl='https://gateway.example/v1' />)
  await user.click(screen.getByRole('tab', { name: 'cURL' }))
  await user.keyboard('{ArrowRight}{Enter}')
  await waitFor(() =>
    expect(screen.getByRole('tab', { name: 'Python' })).toHaveAttribute(
      'aria-selected',
      'true'
    )
  )
  await user.click(screen.getByRole('button', { name: 'Copy code' }))
  const copied = await navigator.clipboard.readText()
  expect(copied).toContain('from openai import OpenAI')
  expect(copied).toContain('https://gateway.example/v1')
  expect(copied).toContain('os.environ["API_KEY"]')
  expect(copied).not.toContain('curl')
})

test('an empty catalog shows an empty state rather than invented models', async () => {
  await mount({ data: { ...pricing, data: [], vendors: [] } })
  expect(screen.getByText('No models available')).toBeVisible()
  expect(
    screen.queryByRole('heading', { name: 'example-chat' })
  ).not.toBeInTheDocument()
})

test('a failed catalog can be retried without hiding the homepage', async () => {
  const user = userEvent.setup()
  vi.mocked(api.get).mockImplementation(async (url) => {
    if (url === '/api/pricing') throw new Error('Catalog unavailable')
    return { data: { success: true, data: '' } }
  })
  await mount({ fail: true })
  expect(await screen.findByText('Failed to load models')).toBeVisible()
  vi.mocked(api.get).mockResolvedValue({ data: pricing })
  await user.click(screen.getByRole('button', { name: 'Retry' }))
  expect(
    await screen.findByRole('heading', { name: 'example-chat' })
  ).toBeVisible()
})

test('a private catalog does not fetch or expose cached models to guests', async () => {
  await mount({ restricted: true })
  const catalog = within(
    screen.getByRole('region', { name: 'Find your next model.' })
  )
  expect(catalog.getByText('Sign in required')).toBeVisible()
  expect(
    screen.queryByRole('heading', { name: 'example-chat' })
  ).not.toBeInTheDocument()
  expect(
    vi.mocked(api.get).mock.calls.some(([url]) => url === '/api/pricing')
  ).toBe(false)
})

test('switching to Traditional Chinese formats context without an Intl error', async () => {
  await mount()
  await act(async () => {
    await i18next.changeLanguage('zhTW')
  })
  expect(screen.getByRole('heading', { name: 'example-chat' })).toBeVisible()
  expect(screen.getByText(/12.8萬 Context/)).toBeVisible()
})
