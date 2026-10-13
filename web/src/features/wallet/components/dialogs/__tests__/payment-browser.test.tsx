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
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { CreemConfirmDialog } from '../creem-confirm-dialog'
import { PaymentConfirmDialog } from '../payment-confirm-dialog'

function renderConfirmation(creem: boolean) {
  const onConfirm = vi.fn()
  const onOpenChange = vi.fn()
  const props = { open: true, onConfirm, onOpenChange, processing: false }
  render(
    creem ? (
      <CreemConfirmDialog
        {...props}
        product={{
          name: 'Credit',
          productId: 'test',
          price: 1,
          quota: 1,
          currency: 'USD',
        }}
      />
    ) : (
      <PaymentConfirmDialog
        {...props}
        topupAmount={1}
        paymentAmount={1}
        paymentMethod={{ name: 'Alipay', type: 'alipay' }}
        calculating={false}
      />
    )
  )
  return { onConfirm, onOpenChange }
}

describe.each([false, true])('recharge confirmation (Creem: %s)', (creem) => {
  it.each([
    [
      'WeChat',
      'Mozilla/5.0 (Linux; Android 14) Chrome/120.0 Mobile MQQBrowser/6.2 MicroMessenger/8.0.50',
    ],
    [
      'WeChat',
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Mobile/15E148 micromessenger/8.0.50',
    ],
    ['Alipay', 'Mozilla/5.0 (Linux; Android 14) Mobile AlipayClient/10.6.0'],
    ['QQ', 'Mozilla/5.0 (Linux; Android 14) MQQBrowser/6.2 QQ/9.0.0 Mobile'],
    ['QQ', 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Mobile/15E148 QQ/9.0.0'],
  ])(
    'shows the %s warning and blocks confirmation in %s',
    async (browser, userAgent) => {
      vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(userAgent)
      const { onConfirm, onOpenChange } = renderConfirmation(creem)
      const warning = screen.getByRole('alert')
      expect(warning).toHaveTextContent(
        `Top-ups are unavailable in the ${browser} in-app browser.`
      )
      expect(warning).toHaveTextContent(
        'Open this page in your system browser to continue.'
      )
      const confirm = screen.getByRole('button', { name: 'Confirm Payment' })
      expect(confirm).toBeDisabled()
      await userEvent.click(confirm)
      expect(onConfirm).not.toHaveBeenCalled()
      await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
      expect(onOpenChange.mock.calls[0][0]).toBe(false)
    }
  )

  it.each([
    'Mozilla/5.0 (Linux; Android 14) Chrome/120.0 Mobile Safari/537.36',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Version/17.0 Mobile/15E148 Safari/604.1',
    'Mozilla/5.0 (Linux; Android 14) MQQBrowser/14.0 Mobile Safari/537.36',
  ])('allows payment without an in-app warning in %s', async (userAgent) => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(userAgent)
    const { onConfirm } = renderConfirmation(creem)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    await userEvent.click(
      screen.getByRole('button', { name: 'Confirm Payment' })
    )
    expect(onConfirm).toHaveBeenCalledOnce()
  })
})
