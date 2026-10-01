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
import { getCoreRowModel, useReactTable } from '@tanstack/react-table'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Toaster, toast } from 'sonner'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'

import { apiKeySchema } from '../../types'
import { ApiKeysProvider } from '../api-keys-provider'
import { DataTableRowActions } from '../data-table-row-actions'

let client: QueryClient
const key = apiKeySchema.parse({
  id: 7,
  name: '我的渠道 🔑',
  key: 'masked****',
  status: 1,
  remain_quota: 1,
  used_quota: 0,
  unlimited_quota: false,
  expired_time: -1,
  created_time: 0,
  accessed_time: 0,
  model_limits_enabled: false,
})
function Actions() {
  const table = useReactTable({
    data: [key],
    columns: [],
    getCoreRowModel: getCoreRowModel(),
  })
  return <DataTableRowActions row={table.getRowModel().rows[0]} />
}
function renderActions() {
  return render(
    <QueryClientProvider client={client}>
      <ApiKeysProvider>
        <Actions />
      </ApiKeysProvider>
      <Toaster />
    </QueryClientProvider>
  )
}
beforeEach(() => {
  localStorage.clear()
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, enabled: false } },
  })
  client.setQueryData(['status'], { server_address: 'https://gateway.example' })
})
afterEach(() => {
  cleanup()
  client.clear()
  toast.dismiss()
  localStorage.clear()
})

it('copies the real key as a Kelivo config directly from the action button', async () => {
  const user = userEvent.setup()
  const write = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue()
  const request = vi
    .spyOn(api, 'post')
    .mockResolvedValue({ data: { success: true, data: { key: 'real-key' } } })
  renderActions()
  expect(request).not.toHaveBeenCalled()
  const button = screen.getByRole('button', { name: 'Copy Kelivo config' })
  button.focus()
  await user.keyboard('{Enter}')
  await waitFor(() => expect(write).toHaveBeenCalledOnce())
  expect(request).toHaveBeenCalledWith('/api/token/7/key')
  const text = write.mock.calls[0][0]
  expect(text.startsWith('ai-provider:v1:')).toBe(true)
  expect(
    JSON.parse(Buffer.from(text.slice(15), 'base64').toString('utf8'))
  ).toEqual({
    type: 'openai',
    name: '我的渠道 🔑',
    apiKey: 'sk-real-key',
    baseUrl: 'https://gateway.example/v1',
  })
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})

it('disables copying while fetching the real key and does not copy on failure', async () => {
  const user = userEvent.setup()
  const write = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue()
  let finish!: (value: { data: { success: boolean; message: string } }) => void
  vi.spyOn(api, 'post').mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve
      })
  )
  renderActions()
  const button = screen.getByRole('button', { name: 'Copy Kelivo config' })
  await user.click(button)
  expect(button).toBeDisabled()
  finish({ data: { success: false, message: 'Key unavailable' } })
  await waitFor(() => expect(button).toBeEnabled())
  expect(write).not.toHaveBeenCalled()
})

it('reports clipboard failure without claiming success', async () => {
  const user = userEvent.setup()
  vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(
    new Error('Denied')
  )
  vi.spyOn(api, 'post').mockResolvedValue({
    data: { success: true, data: { key: 'real-key' } },
  })
  const original = Object.getOwnPropertyDescriptor(document, 'execCommand')
  Object.defineProperty(document, 'execCommand', {
    configurable: true,
    value: vi.fn(() => false),
  })
  try {
    renderActions()
    await user.click(screen.getByRole('button', { name: 'Copy Kelivo config' }))
    expect(await screen.findByText('Copy failed')).toBeVisible()
    expect(screen.queryByText('Copied')).not.toBeInTheDocument()
  } finally {
    if (original) Object.defineProperty(document, 'execCommand', original)
    else Reflect.deleteProperty(document, 'execCommand')
  }
})
