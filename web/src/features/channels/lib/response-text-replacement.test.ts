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
import { describe, expect, it } from 'vitest'

import type { Channel } from '../types'
import { getChannelConfigurationSection } from './channel-configuration'
import {
  buildSettingJSON,
  CHANNEL_FORM_DEFAULT_VALUES,
  transformChannelToFormDefaults,
} from './channel-form'

describe('response replacement migration', () => {
  it('round trips custom rules alongside upstream transport and websocket settings', () => {
    const rules = [
      { pattern: 'internal', replacement: 'public', scope: 'error' as const },
    ]
    const values = {
      ...CHANNEL_FORM_DEFAULT_VALUES,
      type: 1,
      response_text_replacements: rules,
      http_protocol: 'auto' as const,
      http2_connection_shards: 3,
      responses_websocket_enabled: true,
    }
    const setting = buildSettingJSON(values)
    const saved = JSON.parse(setting)
    expect(saved.response_text_replacements).toEqual(rules)
    expect(saved.http2_connection_shards).toBe(3)
    expect(saved.responses_websocket_enabled).toBe(true)
    const restored = transformChannelToFormDefaults({
      id: 1,
      type: 1,
      channel_info: { multi_key_mode: 'random' },
      setting,
    } as Channel)
    expect(restored.response_text_replacements).toEqual(rules)
    expect(getChannelConfigurationSection('response_text_replacements')).toBe(
      'request'
    )
  })
})
