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
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

import { ConfirmDialog } from '../confirm-dialog'

afterEach(() => {
  vi.useRealTimers()
})

function dialog(open: boolean, onConfirm: () => void = () => {}) {
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={() => {}}
      title='Delete item?'
      desc='Gone for good.'
      destructive
      confirmText='Delete'
      confirmDelay={3}
      handleConfirm={onConfirm}
    />
  )
}

it('keeps the confirm button locked with a countdown until the delay has passed', async () => {
  vi.useFakeTimers()
  const onConfirm = vi.fn()
  render(dialog(true, onConfirm))
  const locked = screen.getByRole('button', { name: 'Delete (3)' })
  expect(locked).toBeDisabled()
  fireEvent.click(locked)
  expect(onConfirm).not.toHaveBeenCalled()
  await act(async () => vi.advanceTimersByTime(1000))
  expect(screen.getByRole('button', { name: 'Delete (2)' })).toBeDisabled()
  await act(async () => vi.advanceTimersByTime(2000))
  const ready = screen.getByRole('button', { name: 'Delete' })
  expect(ready).toBeEnabled()
  fireEvent.click(ready)
  expect(onConfirm).toHaveBeenCalledTimes(1)
})

it('restarts the countdown each time the dialog opens', async () => {
  vi.useFakeTimers()
  const view = render(dialog(true))
  await act(async () => vi.advanceTimersByTime(3000))
  expect(screen.getByRole('button', { name: 'Delete' })).toBeEnabled()
  view.rerender(dialog(false))
  view.rerender(dialog(true))
  expect(screen.getByRole('button', { name: 'Delete (3)' })).toBeDisabled()
})

it('enables the confirm button at once when no delay is configured', () => {
  render(
    <ConfirmDialog
      open
      onOpenChange={() => {}}
      title='Delete item?'
      desc='Gone for good.'
      confirmText='Delete'
      handleConfirm={() => {}}
    />
  )
  expect(screen.getByRole('button', { name: 'Delete' })).toBeEnabled()
})
