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

/**
 * `full`: every glass surface is shader-drawn. `frosted`: no WebGL at all;
 * the navigation keeps a CSS backdrop blur and other panels fall back to a
 * plain translucent fill.
 */
export type GlassTier = 'full' | 'frosted'

/**
 * Desktops and Apple mobile devices get the full optical glass. Other phones
 * and tablets, and Huawei/Honor devices even in desktop mode (their older
 * browsers struggle with many WebGL contexts), get the frosted tier.
 */
export function detectGlassTier(
  userAgent = navigator.userAgent,
  touchPoints = navigator.maxTouchPoints
): GlassTier {
  if (/huawei|honor|harmonyos|hmscore/i.test(userAgent)) return 'frosted'
  if (/iphone|ipad|ipod/i.test(userAgent)) return 'full'
  // iPadOS reports itself as a Mac but is the only Mac with touch points.
  if (/macintosh/i.test(userAgent) && touchPoints > 1) return 'full'
  if (/android|mobile|tablet/i.test(userAgent)) return 'frosted'
  return 'full'
}
