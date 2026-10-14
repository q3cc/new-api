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
import { describe, expect, test } from 'vitest'

import { getMessageActionsVisibilityClass } from '../lib/message/message-action-utils'

describe('message action visibility', () => {
  test('reveals the icon row without hover on a touch device', () => {
    const classes = getMessageActionsVisibilityClass(false).split(' ')

    // A finger cannot hover, so the reveal must key off the pointer capability
    // rather than a viewport breakpoint that a touch tablet would miss.
    expect(classes.includes('pointer-coarse:opacity-100')).toBe(true)
    expect(classes.some((name) => name.startsWith('max-md:'))).toBe(false)
  })

  test('keeps the hover reveal for a fine pointer', () => {
    const classes = getMessageActionsVisibilityClass(false).split(' ')

    expect(classes.includes('opacity-0')).toBe(true)
    expect(classes.includes('group-hover:opacity-100')).toBe(true)
  })

  test('pins the actions open when the caller always shows them', () => {
    const classes = getMessageActionsVisibilityClass(true).split(' ')

    expect(classes).toEqual(['opacity-100'])
  })
})
