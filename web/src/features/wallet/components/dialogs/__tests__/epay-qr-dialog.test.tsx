import { act, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'

import { EpayQrDialog } from '../epay-qr-dialog'

describe('EpayQrDialog', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })
  it('renders a QR code SVG when qrcode is provided', () => {
    render(
      <EpayQrDialog
        payment={{
          trade_no: 'USR1NOabc',
          qrcode: 'weixin://wxpay/bizpayurl?pr=test',
        }}
        onOpenChange={() => {}}
        onPaid={() => {}}
      />
    )
    const svg = document.querySelector('svg')
    expect(svg).toBeInTheDocument()
  })

  it('renders the web page link when both qrcode and pay_url are provided', () => {
    render(
      <EpayQrDialog
        payment={{
          trade_no: 'USR1NOdef',
          qrcode: 'weixin://wxpay/bizpayurl?pr=test',
          pay_url: 'https://pay.example.com/qr/2',
        }}
        onOpenChange={() => {}}
        onPaid={() => {}}
      />
    )
    expect(screen.getByText(/open the payment page instead/i)).toHaveAttribute(
      'href',
      'https://pay.example.com/qr/2'
    )
  })

  it('renders the URL scheme link when url_scheme is provided', () => {
    render(
      <EpayQrDialog
        payment={{
          trade_no: 'USR1NOghi',
          url_scheme: 'alipays://platformapi/startapp?appId=test',
        }}
        onOpenChange={() => {}}
        onPaid={() => {}}
      />
    )
    expect(screen.getByText(/open the payment app/i)).toHaveAttribute(
      'href',
      'alipays://platformapi/startapp?appId=test'
    )
  })

  it('does not show the dialog when payment is null', () => {
    const { container } = render(
      <EpayQrDialog payment={null} onOpenChange={() => {}} onPaid={() => {}} />
    )
    expect(container.querySelector('[role="dialog"]')).not.toBeInTheDocument()
  })

  it('reports a paid order once when a poll sees the settled status', async () => {
    vi.useFakeTimers()
    vi.spyOn(api, 'get').mockResolvedValue({
      data: {
        success: true,
        data: {
          trade_no: 'USR1NOpoll',
          status: 'success',
          amount: 10,
          money: 0.1,
        },
      },
    })
    const onPaid = vi.fn()
    const onOpenChange = vi.fn()
    render(
      <EpayQrDialog
        payment={{
          trade_no: 'USR1NOpoll',
          qrcode: 'weixin://wxpay/bizpayurl?pr=x',
        }}
        onOpenChange={onOpenChange}
        onPaid={onPaid}
      />
    )

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000)
    })

    expect(onPaid).toHaveBeenCalledTimes(1)
    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(api.get).toHaveBeenCalledTimes(1)
  })
})
