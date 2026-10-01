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
import { expect, it } from 'vitest'

import { encodeKelivoConfig } from '../kelivo-config'

it.each([
  ['https://gateway.example', 'raw-key', 'https://gateway.example/v1'],
  ['https://gateway.example/v1/', 'sk-real-key', 'https://gateway.example/v1'],
  [
    'https://gateway.example/proxy/',
    'raw-key',
    'https://gateway.example/proxy/v1',
  ],
])('encodes a UTF-8 Kelivo provider for %s', (url, key, baseUrl) => {
  const result = encodeKelivoConfig('我的渠道 🔑', key, url)
  expect(result.startsWith('ai-provider:v1:')).toBe(true)
  const decoded = JSON.parse(
    Buffer.from(result.slice('ai-provider:v1:'.length), 'base64').toString(
      'utf8'
    )
  )
  expect(decoded).toEqual({
    type: 'openai',
    name: '我的渠道 🔑',
    apiKey: key.startsWith('sk-') ? key : `sk-${key}`,
    baseUrl,
  })
})
