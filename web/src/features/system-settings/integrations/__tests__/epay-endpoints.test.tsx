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
import { useState } from 'react'
import { expect, it, vi } from 'vitest'

import type { EpayEndpoint } from '../epay-api'
import { EpayEndpointsEditor } from '../epay-endpoints-editor'
import { PaymentMethodDialog } from '../payment-method-dialog'
import { PaymentMethodsVisualEditor } from '../payment-methods-visual-editor'

const service: EpayEndpoint = {
  id: 'a',
  name: 'Payment A',
  address: 'https://a.example.com',
  merchant_id: '101',
  has_key: true,
  enabled: true,
  mapi: false,
}

it('editing a service without a new secret preserves its key and does not submit the settings form', async () => {
  const changed = vi.fn()
  const submitted = vi.fn((event) => event.preventDefault())
  render(
    <form onSubmit={submitted}>
      <EpayEndpointsEditor endpoints={[service]} onChange={changed} />
    </form>
  )
  await userEvent.click(screen.getByRole('button', { name: 'Edit' }))
  const name = screen.getByRole('textbox', { name: 'Name' })
  await userEvent.clear(name)
  await userEvent.type(name, 'Renamed service')
  expect(screen.getByLabelText('Epay secret key')).toHaveValue('')
  await userEvent.click(screen.getByRole('button', { name: 'Apply' }))
  await waitFor(() =>
    expect(changed).toHaveBeenCalledWith([
      { ...service, name: 'Renamed service' },
    ])
  )
  expect(submitted).not.toHaveBeenCalled()
})

it('a new service needs a secret before it can be added', async () => {
  const changed = vi.fn()
  render(<EpayEndpointsEditor endpoints={[]} onChange={changed} />)
  expect(screen.getByText('No payment services configured')).toBeVisible()
  await userEvent.click(
    screen.getByRole('button', { name: 'Add payment service' })
  )
  await userEvent.type(
    screen.getByRole('textbox', { name: 'Name' }),
    'New service'
  )
  await userEvent.type(
    screen.getByRole('textbox', { name: 'Epay endpoint' }),
    'https://new.example.com'
  )
  await userEvent.type(
    screen.getByRole('textbox', { name: 'Epay merchant ID' }),
    '102'
  )
  await userEvent.click(screen.getByRole('button', { name: 'Apply' }))
  expect(await screen.findByText('Epay secret key is required')).toBeVisible()
  expect(changed).not.toHaveBeenCalled()
  await userEvent.type(screen.getByLabelText('Epay secret key'), 'new-secret')
  await userEvent.click(screen.getByRole('button', { name: 'Apply' }))
  await waitFor(() =>
    expect(changed).toHaveBeenCalledWith([
      expect.objectContaining({
        name: 'New service',
        key: 'new-secret',
        enabled: true,
      }),
    ])
  )
})

it('disabling a service preserves its identity and prevents edits when the editor is disabled', async () => {
  function Editor() {
    const [endpoints, setEndpoints] = useState([service])
    return <EpayEndpointsEditor endpoints={endpoints} onChange={setEndpoints} />
  }
  const rendered = render(<Editor />)
  const toggle = screen.getByRole('switch', {
    name: 'Enable payment service Payment A',
  })
  await userEvent.click(toggle)
  expect(toggle).not.toBeChecked()
  expect(screen.getByText(service.address)).toBeVisible()
  rendered.rerender(
    <EpayEndpointsEditor endpoints={[service]} onChange={vi.fn()} disabled />
  )
  expect(screen.getByRole('button', { name: 'Edit' })).toBeDisabled()
  expect(
    screen.getByRole('button', { name: 'Add payment service' })
  ).toBeDisabled()
  expect(screen.getByRole('switch')).toHaveAttribute('aria-disabled', 'true')
})

it('an Epay payment method requires a service binding and preserves the selected service when edited', async () => {
  const save = vi.fn()
  const changed = vi.fn()
  const method = { name: 'Alipay', type: 'alipay' }
  render(
    <PaymentMethodDialog
      open
      onOpenChange={changed}
      onSave={save}
      editData={method}
      endpoints={[service]}
    />
  )
  await userEvent.click(screen.getByRole('button', { name: 'Update' }))
  expect(
    await screen.findAllByText('Choose a payment service')
  ).not.toHaveLength(0)
  expect(save).not.toHaveBeenCalled()
  await userEvent.click(
    screen.getByRole('combobox', { name: 'Payment service' })
  )
  await userEvent.click(
    await screen.findByRole('option', { name: 'Payment A' })
  )
  await userEvent.click(screen.getByRole('button', { name: 'Update' }))
  await waitFor(() =>
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({ epay_endpoint_id: 'a', type: 'alipay' })
    )
  )
})

it('an invalid service URL displays a validation error without saving', async () => {
  const changed = vi.fn()
  render(<EpayEndpointsEditor endpoints={[service]} onChange={changed} />)
  await userEvent.click(screen.getByRole('button', { name: 'Edit' }))
  const address = screen.getByRole('textbox', { name: 'Epay endpoint' })
  await userEvent.clear(address)
  await userEvent.type(address, 'not-a-url')
  await userEvent.click(screen.getByRole('button', { name: 'Apply' }))
  expect(
    await screen.findByText('Enter a valid payment service URL')
  ).toBeVisible()
  expect(address).toHaveAttribute('aria-invalid', 'true')
  expect(changed).not.toHaveBeenCalled()
})

it('payment method lists show the bound service name on desktop and mobile', () => {
  render(
    <PaymentMethodsVisualEditor
      endpoints={[service]}
      value='[{"name":"Alipay","type":"alipay","epay_endpoint_id":"a"}]'
      onChange={vi.fn()}
    />
  )
  expect(screen.getAllByText('Payment A')).toHaveLength(2)
  expect(
    screen.getByRole('columnheader', { name: 'Payment service' })
  ).toBeInTheDocument()
})
