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
import { API_KEY_STATUS } from '@/features/keys/constants'

export type ChatLinkType = 'web' | 'custom-protocol' | 'fluent'

export type ChatPreset = {
  id: string
  name: string
  url: string
  type: ChatLinkType
}

export type RawChatConfig =
  | string
  | Record<string, unknown>
  | Array<Record<string, unknown>>
  | null
  | undefined

export type ResolveChatUrlParams = {
  template: string
  apiKey?: string
  serverAddress: string
  models?: string[]
}

export type ActiveApiKey = {
  key: string
  status: number
}

const HTTP_REGEX = /^https?:\/\//i

export const CHATBOX_PRESET_URL =
  'chatbox://provider/import?config={chatboxConfig}'

function toBase64(value: string) {
  if (typeof window !== 'undefined' && typeof window.btoa === 'function') {
    const bytes = new TextEncoder().encode(value)
    return window.btoa(
      Array.from(bytes, (byte) => String.fromCharCode(byte)).join('')
    )
  }

  type BufferConstructorLike = {
    from(data: string, encoding: string): { toString(encoding: string): string }
  }

  const globalObj =
    typeof globalThis !== 'undefined'
      ? (globalThis as Record<string, unknown>)
      : undefined
  const bufferCtor = globalObj?.Buffer

  if (
    typeof bufferCtor === 'function' &&
    typeof (bufferCtor as unknown as BufferConstructorLike).from === 'function'
  ) {
    return (bufferCtor as unknown as BufferConstructorLike)
      .from(value, 'utf-8')
      .toString('base64')
  }

  return ''
}

export function detectChatLinkType(url: string): ChatLinkType {
  if (HTTP_REGEX.test(url)) {
    return 'web'
  }
  if (url.toLowerCase().startsWith('fluent')) {
    return 'fluent'
  }
  return 'custom-protocol'
}

export function chatLinkRequiresApiKey(url: string): boolean {
  return (
    url.includes('{key}') ||
    url.includes('{cherryConfig}') ||
    url.includes('{aionuiConfig}') ||
    url.includes('{deepchatConfig}') ||
    url.includes('{aqbotConfig}') ||
    url.includes('{chatboxConfig}')
  )
}

export function parseChatConfig(raw: RawChatConfig): ChatPreset[] {
  let parsed: unknown = raw

  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw)
    } catch {
      return []
    }
  }

  if (!Array.isArray(parsed)) {
    return []
  }

  return parsed
    .map((entry, index) => {
      if (
        !entry ||
        typeof entry !== 'object' ||
        Array.isArray(entry) ||
        Object.keys(entry).length !== 1
      ) {
        return null
      }

      const [name, value] = Object.entries(entry)[0]
      if (typeof value !== 'string' || typeof name !== 'string') {
        return null
      }

      const url = value.trim()
      if (!url) {
        return null
      }

      return {
        id: String(index),
        name,
        url,
        type: detectChatLinkType(url),
      } satisfies ChatPreset
    })
    .filter((item): item is ChatPreset => item !== null)
}

function replaceToken(source: string, token: string, value: string) {
  return source.split(token).join(value)
}

function normalizeApiKey(apiKey: string): string {
  const trimmed = apiKey.trim()
  if (!trimmed) return ''
  return trimmed.startsWith('sk-') ? trimmed : `sk-${trimmed}`
}

export function resolveChatUrl({
  template,
  apiKey,
  serverAddress,
  models = [],
}: ResolveChatUrlParams): string {
  let url = template
  const safeServerAddress = serverAddress || ''

  const safeApiKey = normalizeApiKey(apiKey || '')

  if (url.includes('{chatboxConfig}')) {
    if (!safeApiKey) {
      return ''
    }
    let address: URL
    try {
      address = new URL(safeServerAddress)
    } catch {
      return ''
    }
    if (
      !['https:', 'http:'].includes(address.protocol) ||
      address.username ||
      address.password
    ) {
      return ''
    }
    address.search = ''
    address.hash = ''
    address.pathname = address.pathname.replace(/\/+$/, '').replace(/\/v1$/, '')
    const apiHost = address.toString().replace(/\/+$/, '')
    const payload = {
      isCustom: true,
      id: `new-api:${apiHost}`,
      name: 'New API',
      type: 'openai',
      iconUrl: `${apiHost}/favicon.ico`,
      urls: { website: apiHost },
      settings: {
        apiHost,
        apiPath: '/v1/chat/completions',
        apiKey: safeApiKey,
        models: [...new Set(models)]
          .filter(Boolean)
          .map((modelId) => ({ modelId })),
      },
    }
    return replaceToken(
      url,
      '{chatboxConfig}',
      encodeURIComponent(toBase64(JSON.stringify(payload)))
    )
  }

  if (url.includes('{cherryConfig}')) {
    const payload = {
      id: 'new-api',
      baseUrl: safeServerAddress,
      apiKey: safeApiKey,
    }
    const encoded = encodeURIComponent(toBase64(JSON.stringify(payload)))
    return replaceToken(url, '{cherryConfig}', encoded)
  }

  if (url.includes('{aionuiConfig}')) {
    const payload = {
      platform: 'new-api',
      baseUrl: safeServerAddress,
      apiKey: safeApiKey,
    }
    const encoded = encodeURIComponent(toBase64(JSON.stringify(payload)))
    return replaceToken(url, '{aionuiConfig}', encoded)
  }

  if (url.includes('{deepchatConfig}')) {
    const payload = {
      id: 'new-api',
      baseUrl: safeServerAddress,
      apiKey: safeApiKey,
    }
    const encoded = encodeURIComponent(toBase64(JSON.stringify(payload)))
    return replaceToken(url, '{deepchatConfig}', encoded)
  }

  if (url.includes('{aqbotConfig}')) {
    const query = [
      `name=${encodeURIComponent('New API')}`,
      `baseurl=${encodeURIComponent(safeServerAddress)}`,
      `apikey=${encodeURIComponent(safeApiKey)}`,
      'type=openai',
    ].join('&')
    return replaceToken(url, '{aqbotConfig}', query)
  }

  if (safeServerAddress) {
    const encodedAddress = encodeURIComponent(safeServerAddress)
    url = replaceToken(url, '{address}', encodedAddress)
  }

  if (safeApiKey) {
    url = replaceToken(url, '{key}', safeApiKey)
  }

  return url
}

export function getFirstActiveKey(
  keys: ActiveApiKey[] | undefined
): ActiveApiKey | undefined {
  if (!Array.isArray(keys)) return undefined
  return keys.find((item) => item.status === API_KEY_STATUS.ENABLED)
}
