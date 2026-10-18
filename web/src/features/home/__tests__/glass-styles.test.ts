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

import { readFileSync } from 'node:fs'

import { expect, test } from 'vitest'

const css = readFileSync('src/styles/home.css', 'utf8')

test('glass blur keeps the standard declaration last so production minification preserves Chrome support', () => {
  // Lightning CSS drops the standard property when a prefixed alias comes
  // after it. Let the build add prefixes, or put a manual alias first.
  const materials = [...css.matchAll(/\{([^{}]*)\}/g)]
    .map((block) =>
      [...block[1].matchAll(/((?:-webkit-)?backdrop-filter)\s*:/g)].map(
        (match) => match[1]
      )
    )
    .filter((properties) => properties.length > 0)
  expect(materials.length).toBeGreaterThan(0)
  for (const properties of materials) {
    expect(properties.at(-1)).toBe('backdrop-filter')
  }
})

test('the frosted tier gives the secondary action an opaque fill for contrast', () => {
  // Without backdrop blur the button sits straight on the random wallpaper;
  // a translucent fill leaves its light label unreadable on bright pictures.
  const rule = css.match(
    /\.cinematic-home\[data-glass-tier='frosted'\]\s+\.home-secondary\s*\{([^}]*)\}/
  )
  expect(rule).not.toBeNull()
  expect(rule?.[1]).toMatch(/background:\s*#22303f/)
  expect(rule?.[1]).toMatch(/color:\s*#f1f5f9/)
})

test('returning to the top removes the navigation pill without a fade', () => {
  // The scrolled pill has a 0.3s background transition; without this the pill
  // would keep showing for that long after the page returns to the top.
  const rule = css.match(
    /\.cinematic-home\.cinematic-home header:not\(\[data-scrolled\]\) nav\s*\{([^}]*)\}/
  )
  expect(rule).not.toBeNull()
  expect(rule?.[1]).toMatch(/transition:\s*none/)
})
