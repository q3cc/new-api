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
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { expect, it } from 'vitest'

import { TicketImagePicker } from '../components/ticket-image-picker'

function Harness() {
  const [images, setImages] = useState<File[]>([])
  return <TicketImagePicker images={images} onChange={setImages} />
}

function png(name: string) {
  return new File([new Uint8Array(32)], name, { type: 'image/png' })
}

it('opens the file dialog from a translated button instead of the native control', async () => {
  render(<Harness />)
  const group = screen.getByRole('group', { name: 'Screenshots' })
  expect(
    within(group).getByRole('button', { name: 'Attach images' })
  ).toBeEnabled()
  expect(within(group).getByText('0 / 3 selected')).toBeInTheDocument()
  // The browser's own file control stays hidden.
  expect(
    screen.getByLabelText('Attach images', { selector: 'input' })
  ).not.toBeVisible()
})

it('lists picked images and removes one on request', async () => {
  const user = userEvent.setup()
  render(<Harness />)
  const input = screen.getByLabelText('Attach images', { selector: 'input' })
  await user.upload(input, [png('a.png'), png('b.png')])
  const items = screen.getAllByRole('listitem')
  expect(items.map((item) => item.textContent)).toEqual([
    expect.stringContaining('a.png'),
    expect.stringContaining('b.png'),
  ])
  expect(screen.getByText('2 / 3 selected')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Remove a.png' }))
  expect(
    screen.getAllByRole('listitem').map((item) => item.textContent)
  ).toEqual([expect.stringContaining('b.png')])
})

it('refuses an SVG without adding it, and disables the button at three images', async () => {
  const user = userEvent.setup({ applyAccept: false })
  render(<Harness />)
  const input = screen.getByLabelText('Attach images', { selector: 'input' })
  await user.upload(
    input,
    new File(['<svg/>'], 'x.svg', { type: 'image/svg+xml' })
  )
  expect(screen.getByRole('alert')).toHaveTextContent(
    'Only PNG, JPEG, GIF and WebP images are supported'
  )
  expect(screen.queryAllByRole('listitem')).toHaveLength(0)

  await user.upload(input, [png('a.png'), png('b.png'), png('c.png')])
  expect(screen.queryByRole('alert')).toBeNull()
  expect(screen.getAllByRole('listitem')).toHaveLength(3)
  expect(screen.getByRole('button', { name: 'Attach images' })).toBeDisabled()
})
