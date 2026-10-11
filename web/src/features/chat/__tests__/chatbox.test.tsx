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
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, expect, it, vi } from 'vitest'

import { ChatSettingsVisualEditor } from '@/features/system-settings/content/chat-settings-visual-editor'

import {
  CHATBOX_PRESET_URL,
  chatLinkRequiresApiKey,
  resolveChatUrl,
} from '../lib/chat-links'
import { fetchChatboxModels } from '../lib/chatbox-models'

afterEach(() => vi.unstubAllGlobals())

it('quickly adds a key-free Chatbox preset without submitting or replacing other presets', async () => {
  const submitted = vi.fn((event) => event.preventDefault())
  function Editor() {
    const [value, setValue] = useState('[{"Existing":"https://example.com"}]')
    return (
      <form onSubmit={submitted}>
        <ChatSettingsVisualEditor value={value} onChange={setValue} />
      </form>
    )
  }
  render(<Editor />)
  await userEvent.click(screen.getByRole('button', { name: 'Add Chatbox' }))
  expect(screen.getByText('Existing')).toBeVisible()
  expect(screen.getByText(CHATBOX_PRESET_URL)).toBeVisible()
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Add Chatbox' })).toBeDisabled()
  )
  expect(submitted).not.toHaveBeenCalled()
  expect(chatLinkRequiresApiKey(CHATBOX_PRESET_URL)).toBe(true)
})

it('exports UTF-8 model IDs and the selected key in the official custom-provider format', () => {
  const url = resolveChatUrl({
    template: CHATBOX_PRESET_URL,
    apiKey: ' selected-key ',
    serverAddress: 'https://api.example.com/gateway/v1/',
    models: ['模型🚀', 'gpt-4o', 'gpt-4o'],
  })
  const config = new URL(url).searchParams.get('config') ?? ''
  const payload = JSON.parse(Buffer.from(config, 'base64').toString('utf8'))
  expect(payload).toMatchObject({
    isCustom: true,
    id: 'new-api:https://api.example.com/gateway',
    name: 'New API',
    type: 'openai',
    settings: {
      apiHost: 'https://api.example.com/gateway',
      apiPath: '/v1/chat/completions',
      apiKey: 'sk-selected-key',
      models: [{ modelId: '模型🚀' }, { modelId: 'gpt-4o' }],
    },
  })
  expect(new URL(url).hostname).toBe('provider')
  expect(new URL(url).pathname).toBe('/import')
  expect(
    resolveChatUrl({
      template: CHATBOX_PRESET_URL,
      serverAddress: 'https://example.com',
    })
  ).toBe('')
  expect(
    resolveChatUrl({
      template: CHATBOX_PRESET_URL,
      apiKey: 'x',
      serverAddress: 'javascript:alert(1)',
    })
  ).toBe('')
  expect(
    resolveChatUrl({
      template: 'https://chat.example/?key={key}',
      apiKey: 'x',
      serverAddress: '',
    })
  ).toBe('https://chat.example/?key=sk-x')
})

it('loads models using only the selected relay credential, without following redirects or caching', async () => {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ data: [{ id: 'allowed-model' }, { id: 123 }, null] }),
  })
  vi.stubGlobal('fetch', fetchMock)
  expect(await fetchChatboxModels('selected-key')).toEqual(['allowed-model'])
  expect(fetchMock).toHaveBeenCalledWith('/v1/models', {
    headers: { Authorization: 'Bearer sk-selected-key' },
    credentials: 'omit',
    cache: 'no-store',
    redirect: 'error',
  })
  fetchMock.mockRejectedValue(new Error('secret-key-sensitive-response'))
  await expect(fetchChatboxModels('selected-key')).rejects.toThrow(
    'Failed to load models'
  )
})
