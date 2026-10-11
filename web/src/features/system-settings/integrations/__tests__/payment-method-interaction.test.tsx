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

import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'

import { PaymentMethodDialog } from '../payment-method-dialog'
import { paymentMethodsSchema } from '../payment-method-schema'
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

it('adding Alipay to another service is valid but adding it twice to the same service is rejected', async () => {
  const save = vi.fn()
  render(
    <PaymentMethodDialog
      open
      onOpenChange={vi.fn()}
      onSave={save}
      endpoints={[endpoint, { ...endpoint, id: 'b', name: 'Payment B' }]}
      existingMethods={[
        { name: 'Alipay A', type: 'alipay', epay_endpoint_id: 'a' },
      ]}
      initialData={{ name: 'Alipay B', type: 'alipay', epay_endpoint_id: 'a' }}
    />
  )
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: /^Add$/ }))
  expect(save).not.toHaveBeenCalled()
  expect(
    await screen.findByText(
      'This payment type is already configured for this service'
    )
  ).toBeVisible()
  await user.click(screen.getByRole('combobox', { name: 'Payment service' }))
  await user.click(await screen.findByRole('option', { name: 'Payment B' }))
  await user.click(screen.getByRole('button', { name: /^Add$/ }))
  await waitFor(() =>
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'alipay', epay_endpoint_id: 'b' })
    )
  )
})
it('whitespace-only payment names are rejected before changing the list', async () => {
  const save = vi.fn()
  render(
    <PaymentMethodDialog
      open
      onOpenChange={vi.fn()}
      onSave={save}
      endpoints={[endpoint]}
      initialData={{ name: '   ', type: 'alipay', epay_endpoint_id: 'a' }}
    />
  )
  await userEvent.click(screen.getByRole('button', { name: /^Add$/ }))
  expect(save).not.toHaveBeenCalled()
  expect(
    await screen.findByText('Payment method name is required')
  ).toBeVisible()
})
it('reordering payment methods preserves separate bindings with the same type', async () => {
  const change = vi.fn()
  render(
    <PaymentMethodsVisualEditor
      value='[{"name":"Alipay A","type":"alipay","epay_endpoint_id":"a"},{"name":"Alipay B","type":"alipay","epay_endpoint_id":"b"}]'
      endpoints={[endpoint, { ...endpoint, id: 'b', name: 'Payment B' }]}
      onChange={change}
    />
  )
  const handles = screen.getAllByRole('button', { name: /Drag .* to reorder/ })
  fireEvent.keyDown(handles[0], { key: 'ArrowDown' })
  expect(
    JSON.parse(change.mock.calls[0][0]).map(
      (m: { epay_endpoint_id: string }) => m.epay_endpoint_id
    )
  ).toEqual(['b', 'a'])
  change.mockClear()
  const transfer = {
    setData: vi.fn(),
    getData: () => '',
    effectAllowed: 'move',
  }
  fireEvent.dragStart(handles[0], { dataTransfer: transfer })
  fireEvent.dragOver(screen.getAllByRole('row')[2], { dataTransfer: transfer })
  fireEvent.drop(screen.getAllByRole('row')[2], { dataTransfer: transfer })
  expect(
    JSON.parse(change.mock.calls[0][0]).map(
      (m: { epay_endpoint_id: string }) => m.epay_endpoint_id
    )
  ).toEqual(['b', 'a'])
})

it('JSON settings permit distinct bindings and reject blank names and duplicate bindings', () => {
  const methods = [
    { name: 'Alipay A', type: 'alipay', epay_endpoint_id: 'a' },
    { name: 'Alipay B', type: 'alipay', epay_endpoint_id: 'b' },
  ]
  expect(paymentMethodsSchema.safeParse(methods).success).toBe(true)
  expect(paymentMethodsSchema.safeParse([...methods, methods[0]]).success).toBe(
    false
  )
  expect(
    paymentMethodsSchema.safeParse([{ ...methods[0], name: '  ' }]).success
  ).toBe(false)
  expect(
    paymentMethodsSchema.safeParse([{ ...methods[0], type: 'bad type' }])
      .success
  ).toBe(false)
})

it('editing the second Alipay with the same name preserves the first service binding', async () => {
  const change = vi.fn()
  render(
    <PaymentMethodsVisualEditor
      value='[{"name":"Alipay","type":"alipay","epay_endpoint_id":"a"},{"name":"Alipay","type":"alipay","epay_endpoint_id":"b"}]'
      endpoints={[endpoint, { ...endpoint, id: 'b', name: 'Payment B' }]}
      onChange={change}
    />
  )
  await userEvent.click(screen.getAllByRole('button', { name: 'Edit' })[1])
  await userEvent.clear(screen.getByRole('textbox', { name: 'Name' }))
  await userEvent.type(
    screen.getByRole('textbox', { name: 'Name' }),
    'Alipay B'
  )
  await userEvent.click(screen.getByRole('button', { name: 'Update' }))
  await waitFor(() => expect(change).toHaveBeenCalled())
  expect(JSON.parse(change.mock.calls[0][0])).toEqual([
    expect.objectContaining({ name: 'Alipay', epay_endpoint_id: 'a' }),
    expect.objectContaining({ name: 'Alipay B', epay_endpoint_id: 'b' }),
  ])
})
it('a single payment method cannot move beyond the list boundaries', () => {
  const change = vi.fn()
  render(
    <PaymentMethodsVisualEditor
      value='[{"name":"Alipay","type":"alipay","epay_endpoint_id":"a"}]'
      endpoints={[endpoint]}
      onChange={change}
    />
  )
  const handle = screen.getAllByRole('button', {
    name: /Drag .* to reorder/,
  })[0]
  expect(handle).toBeDisabled()
  fireEvent.keyDown(handle, { key: 'ArrowUp' })
  fireEvent.keyDown(handle, { key: 'ArrowDown' })
  expect(change).not.toHaveBeenCalled()
})

it('sorting legacy entries with an invalid row preserves it without crashing', () => {
  const change = vi.fn()
  render(
    <PaymentMethodsVisualEditor
      value='[null,{"name":"Alipay A","type":"alipay","epay_endpoint_id":"a"},{"name":"Alipay B","type":"alipay","epay_endpoint_id":"b"}]'
      endpoints={[endpoint, { ...endpoint, id: 'b', name: 'Payment B' }]}
      onChange={change}
    />
  )
  fireEvent.keyDown(
    screen.getAllByRole('button', { name: /Drag .* to reorder/ })[0],
    { key: 'ArrowDown' }
  )
  expect(change).toHaveBeenCalled()
  expect(JSON.parse(change.mock.calls[0][0])).toEqual([
    null,
    expect.objectContaining({ epay_endpoint_id: 'b' }),
    expect.objectContaining({ epay_endpoint_id: 'a' }),
  ])
})
