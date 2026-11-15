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
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import type { AxiosProgressEvent } from 'axios'
import { expect, it, vi } from 'vitest'

import { api, type ApiRequestConfig } from '@/lib/api'

import type { ConversationSummary } from '../conversations-api'
import {
  renderPlayground,
  row,
  server,
  setupPlaygroundServer,
} from './helpers/fake-playground-server'

setupPlaygroundServer()

/**
 * Holds the fetch of one conversation until the test releases it, handing
 * the test the request's progress callback meanwhile.
 */
function holdConversation(id: number) {
  const fakeGet = vi.mocked(api.get).getMockImplementation()
  if (!fakeGet) throw new Error('setupPlaygroundServer mocks api.get')
  let release!: () => void
  const released = new Promise<void>((resolve) => {
    release = resolve
  })
  const held: { config?: ApiRequestConfig } = {}
  vi.mocked(api.get).mockImplementation(async (url, config) => {
    if (url === `/api/playground/conversations/${id}`) {
      held.config = config
      await released
    }
    return fakeGet(url, config)
  })
  const report = (loaded: number) =>
    act(async () =>
      held.config?.onDownloadProgress?.({ loaded } as AxiosProgressEvent)
    )
  return { held, report, release: () => act(async () => release()) }
}

function listedConversation(id: number) {
  return server.client
    .getQueriesData<{ items: ConversationSummary[] }>({
      queryKey: ['playground-conversations'],
    })
    .flatMap(([, data]) => data?.items ?? [])
    .find((item) => item.id === id)
}

it('shows how far an archived conversation has been restored, then opens it', async () => {
  server.records.set(2, {
    ...row(2, 'Beta'),
    archived_at: 1_700_000_000_000,
    content_bytes: 1000,
  })
  const request = holdConversation(2)
  renderPlayground('?conversation=1')
  await screen.findByDisplayValue('draft Alpha')

  fireEvent.click(await screen.findByRole('button', { name: 'Beta' }))
  const bar = await screen.findByRole('progressbar', {
    name: 'Conversation loading progress',
  })
  expect(
    screen.getByText('Restoring a conversation not opened for a while...')
  ).toBeVisible()
  expect(bar).toHaveAttribute('aria-valuenow', '0')
  expect(request.held.config?.adapter).toEqual(['fetch', 'xhr'])

  await request.report(500)
  expect(bar).toHaveAttribute('aria-valuenow', '50')
  expect(screen.getByText('50%')).toBeVisible()
  // The response is a little larger than the document; the bar waits at 99%.
  await request.report(1100)
  expect(bar).toHaveAttribute('aria-valuenow', '99')

  await request.release()
  await screen.findByDisplayValue('draft Beta')
  expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
  // Opening stored it uncompressed again, and the list says so.
  expect(listedConversation(2)?.archived_at).toBe(0)
})

it('shows an indeterminate bar for a conversation of unknown size', async () => {
  const request = holdConversation(2)
  renderPlayground('?conversation=1')
  await screen.findByDisplayValue('draft Alpha')

  fireEvent.click(await screen.findByRole('button', { name: 'Beta' }))
  const bar = await screen.findByRole('progressbar', {
    name: 'Conversation loading progress',
  })
  expect(screen.getByText('Loading conversation...')).toBeVisible()
  expect(bar).not.toHaveAttribute('aria-valuenow')
  await request.report(400)
  expect(bar).not.toHaveAttribute('aria-valuenow')

  await request.release()
  await screen.findByDisplayValue('draft Beta')
  await waitFor(() =>
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
  )
})

it('switches to a conversation already open on this page without loading it again', async () => {
  renderPlayground('?conversation=2')
  await screen.findByDisplayValue('draft Beta')
  fireEvent.click(await screen.findByRole('button', { name: 'Alpha' }))
  await screen.findByDisplayValue('draft Alpha')
  const request = holdConversation(2)

  fireEvent.click(await screen.findByRole('button', { name: 'Beta' }))
  await screen.findByDisplayValue('draft Beta')
  expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
  expect(request.held.config).toBeUndefined()
})
