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
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ModelGroupSelector } from '../../model-group-selector'

const groups = Array.from({ length: 30 }, (_, index) => ({
  label: `group-${index + 1}`,
  value: `group-${index + 1}`,
}))
const models = [
  { label: 'model-a', value: 'model-a' },
  { label: 'model-b', value: 'model-b' },
]

const originalWidth = window.innerWidth
const pointerCapture = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  'setPointerCapture'
)
const scrollIntoView = vi.fn()
const scrolledElements: Element[] = []

beforeEach(() => {
  // A phone-sized window renders the selector as a bottom drawer.
  Object.defineProperty(window, 'innerWidth', {
    configurable: true,
    value: 375,
  })
  // JSDOM lacks the pointer-capture and scrolling APIs the drawer uses.
  Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', {
    configurable: true,
    value: () => undefined,
  })
  Object.defineProperty(Element.prototype, 'scrollIntoView', {
    configurable: true,
    value: scrollIntoView,
  })
  Object.defineProperty(Element.prototype, 'scrollTo', {
    configurable: true,
    value(this: Element) {
      scrolledElements.push(this)
    },
  })
})

afterEach(() => {
  Object.defineProperty(window, 'innerWidth', {
    configurable: true,
    value: originalWidth,
  })
  if (pointerCapture) {
    Object.defineProperty(
      HTMLElement.prototype,
      'setPointerCapture',
      pointerCapture
    )
  } else {
    Reflect.deleteProperty(HTMLElement.prototype, 'setPointerCapture')
  }
  Reflect.deleteProperty(Element.prototype, 'scrollIntoView')
  Reflect.deleteProperty(Element.prototype, 'scrollTo')
  scrollIntoView.mockReset()
  scrolledElements.length = 0
})

function renderSelector() {
  render(
    <ModelGroupSelector
      selectedModel='model-b'
      models={models}
      onModelChange={() => undefined}
      selectedGroup='group-30'
      groups={groups}
      onGroupChange={() => undefined}
    />
  )
}

describe('model group selector on a phone', () => {
  it('opening the drawer scrolls the selected group and model inside their own lists and leaves the drawer unscrolled', async () => {
    renderSelector()

    await userEvent.click(screen.getByRole('combobox'))

    const groupList = await screen.findByRole('group', { name: 'Model Group' })
    const modelList = screen.getByRole('listbox')
    await waitFor(() => {
      expect(scrolledElements).toContain(groupList)
      expect(scrolledElements).toContain(modelList)
    })
    expect(scrollIntoView).not.toHaveBeenCalled()
  })

  it('many groups scroll in their own bounded list so every group stays reachable', async () => {
    renderSelector()

    await userEvent.click(screen.getByRole('combobox'))

    const groupList = await screen.findByRole('group', { name: 'Model Group' })
    expect(
      within(groupList)
        .getAllByRole('button')
        .map((button) => button.textContent)
    ).toEqual(groups.map((group) => group.label))
    const classes = groupList.className.split(' ')
    expect(classes).toContain('overflow-y-auto')
    expect(classes.some((name) => name.startsWith('max-h-'))).toBe(true)
  })
})
