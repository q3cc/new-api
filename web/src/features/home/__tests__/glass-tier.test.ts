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
import { expect, test } from 'vitest'

import { detectGlassTier } from '../lib/glass-tier'

const MAC =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15'
const WINDOWS =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36'
const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'
const ANDROID =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36'
const HUAWEI =
  'Mozilla/5.0 (Linux; Android 10; HarmonyOS; ELS-AN00; HMSCore 6.11.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/99.0 HuaweiBrowser/13.0 Mobile Safari/537.36'
const HUAWEI_DESKTOP_MODE =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/99.0 HuaweiBrowser/13.0 Safari/537.36'

test.each([
  ['a Mac desktop', MAC, 0, 'full'],
  ['a Windows desktop', WINDOWS, 0, 'full'],
  ['an iPhone', IPHONE, 5, 'full'],
  ['an iPad presenting as a Mac', MAC, 5, 'full'],
  ['an Android phone', ANDROID, 5, 'frosted'],
  ['a Huawei phone', HUAWEI, 5, 'frosted'],
  ['a Huawei browser in desktop mode', HUAWEI_DESKTOP_MODE, 0, 'frosted'],
])('%s gets the %s glass tier', (_, userAgent, touchPoints, tier) => {
  expect(detectGlassTier(userAgent, touchPoints)).toBe(tier)
})
