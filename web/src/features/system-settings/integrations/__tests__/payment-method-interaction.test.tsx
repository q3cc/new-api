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

import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'

import { PaymentMethodDialog } from '../payment-method-dialog'
import { PaymentMethodsVisualEditor } from '../payment-methods-visual-editor'

const endpoint = {
  id: 'a',
  name: 'Payment A',
  address: 'https://a.example.com',
  merchant_id: '101',
  has_key: true,
  enabled: true,
}
it('choosing an Epay template opens a prefilled form before adding the required service binding', async () => {
  const change = vi.fn()
  render(
    <PaymentMethodsVisualEditor
      value='[]'
      endpoints={[endpoint]}
      onChange={change}
    />
  )
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: 'Templates' }))
  await user.click(screen.getByRole('button', { name: 'Epay Alipay' }))
  expect(
    await screen.findByRole('dialog', { name: 'Add payment method' })
  ).toBeVisible()
  expect(screen.getByRole('textbox', { name: 'Name' })).toHaveValue('Alipay')
  expect(change).not.toHaveBeenCalled()
  await user.click(screen.getByRole('combobox', { name: 'Payment service' }))
  const list = screen.getByRole('listbox')
  expect(list.closest('[data-slot="select-content"]')).toHaveAttribute(
    'data-align-trigger',
    'false'
  )
  await user.click(await screen.findByRole('option', { name: 'Payment A' }))
  await user.click(screen.getByRole('button', { name: /^Add$/ }))
  await waitFor(() => expect(change).toHaveBeenCalled())
  expect(JSON.parse(change.mock.calls[0][0])).toEqual([
    expect.objectContaining({ type: 'alipay', epay_endpoint_id: 'a' }),
  ])
})
it('choosing a template already in the list opens its existing configuration instead of silently doing nothing', async () => {
  const change = vi.fn()
  render(
    <PaymentMethodsVisualEditor
      value='[{"name":"支付宝","type":"alipay"}]'
      endpoints={[endpoint]}
      onChange={change}
    />
  )
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: 'Templates' }))
  await user.click(screen.getByRole('button', { name: 'Epay Alipay' }))
  expect(
    await screen.findByRole('dialog', { name: 'Edit payment method' })
  ).toBeVisible()
  expect(screen.getByRole('textbox', { name: 'Name' })).toHaveValue('支付宝')
  expect(change).not.toHaveBeenCalled()
})
it('payment service options open below the trigger rather than aligning a row over it', async () => {
  render(
    <PaymentMethodDialog
      open
      onOpenChange={vi.fn()}
      onSave={vi.fn()}
      endpoints={[endpoint]}
      editData={{ name: 'Alipay', type: 'alipay', epay_endpoint_id: 'a' }}
    />
  )
  const user = userEvent.setup()
  await user.click(screen.getByRole('combobox', { name: 'Payment service' }))
  const list = await screen.findByRole('listbox')
  expect(list.closest('[data-slot="select-content"]')).toHaveAttribute(
    'data-align-trigger',
    'false'
  )
})
