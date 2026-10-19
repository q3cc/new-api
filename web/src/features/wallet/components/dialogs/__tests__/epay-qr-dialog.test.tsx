import { act, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'

import { canUseQrPayment, getInAppPaymentLink } from '../../../lib/payment'
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

describe('in-app automatic launch', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it.each([
    ['MicroMessenger/8', 'wxpay', 'weixin://wxpay/bizpayurl?pr=test'],
    [
      'Mozilla/5.0 Version/18 Mobile Safari/604.1',
      'alipay',
      'alipays://platformapi/startapp?appId=test',
    ],
  ])(
    'paints QR then opens %s payment %s once with a retry link',
    async (ua, type, link) => {
      vi.useFakeTimers()
      vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(ua)
      vi.spyOn(api, 'get').mockResolvedValue({
        data: { success: true, data: { status: 'pending' } },
      })
      const click = vi
        .spyOn(HTMLAnchorElement.prototype, 'click')
        .mockImplementation(() => {
          expect(
            screen.getByRole('dialog').querySelector('svg')
          ).toBeInTheDocument()
        })
      const props = {
        payment: {
          trade_no: 'test-launch',
          qrcode: link,
          pay_url: 'https://pay.example.com/fallback',
        },
        onOpenChange: vi.fn(),
        onPaid: vi.fn(),
        paymentType: type,
        autoLaunch: canUseQrPayment({
          name: type,
          type,
          mapi: true,
        }),
      }
      const view = render(<EpayQrDialog {...props} />)
      expect(click).not.toHaveBeenCalled()
      await act(async () => {
        await vi.advanceTimersByTimeAsync(100)
      })
      expect(click).toHaveBeenCalledOnce()
      expect(
        screen.getByRole('link', { name: 'Open the payment app' })
      ).toHaveAttribute('href', props.payment.qrcode)
      view.rerender(<EpayQrDialog {...props} />)
      await act(async () => {
        await vi.advanceTimersByTimeAsync(4000)
      })
      expect(click).toHaveBeenCalledOnce()
    }
  )

  it.each([false, true])(
    'never launches after closing (mode=%s)',
    async (autoLaunch) => {
      vi.useFakeTimers()
      vi.spyOn(api, 'get').mockResolvedValue({ data: {} })
      const click = vi
        .spyOn(HTMLAnchorElement.prototype, 'click')
        .mockImplementation(() => {})
      const view = render(
        <EpayQrDialog
          autoLaunch={autoLaunch}
          payment={{ trade_no: 'closed', qrcode: 'https://pay.example.com' }}
          onOpenChange={() => {}}
          onPaid={() => {}}
        />
      )
      view.rerender(
        <EpayQrDialog
          autoLaunch={autoLaunch}
          payment={null}
          onOpenChange={() => {}}
          onPaid={() => {}}
        />
      )
      await act(async () => {
        await vi.advanceTimersByTimeAsync(100)
      })
      expect(click).not.toHaveBeenCalled()
    }
  )

  it.each([
    'javascript:alert(1)',
    'data:text/html,test',
    'alipays://platformapi/startapp',
    'not a URL',
  ])(
    'keeps QR without launching unsupported payload %s in WeChat',
    (payload) => {
      vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(
        'MicroMessenger/8'
      )
      render(
        <EpayQrDialog
          autoLaunch
          payment={{ trade_no: 'unsafe', qrcode: payload }}
          onOpenChange={() => {}}
          onPaid={() => {}}
        />
      )
      expect(screen.queryByRole('link')).not.toBeInTheDocument()
      expect(
        screen.queryByText(
          'No supported payment link was returned. Use the QR code.'
        )
      ).not.toBeInTheDocument()
    }
  )
})

describe('payment URL opens inside the selected app', () => {
  it('wraps an Alipay HTTPS payment URL in the Alipay browser scheme without losing query parameters', () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Chrome/130')
    const payUrl = 'https://pay.example.com/checkout?order=1&sign=a%2Bb'
    expect(
      getInAppPaymentLink({ trade_no: 'alipay', pay_url: payUrl }, 'alipay')
    ).toBe(
      'alipays://platformapi/startapp?appId=20000067&url=' +
        encodeURIComponent(payUrl)
    )
  })
  it('does not pretend a generic HTTPS page can be opened inside WeChat', () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Chrome/130')
    expect(
      getInAppPaymentLink(
        { trade_no: 'wx', pay_url: 'https://pay.example.com/checkout' },
        'wxpay'
      )
    ).toBeUndefined()
  })
  it('does not launch WeChat H5 payment outside WeChat', () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Chrome/130')
    const payUrl =
      'https://wx.tenpay.com/cgi-bin/mmpayweb-bin/checkmweb?prepay_id=test&package=1'
    expect(
      getInAppPaymentLink({ trade_no: 'wx', pay_url: payUrl }, 'wxpay')
    ).toBeUndefined()
  })
})

it.each([
  ['Chrome/130', 'wxpay', 'weixin://wxpay/bizpayurl?pr=test'],
  ['MicroMessenger/8', 'alipay', 'https://qr.alipay.com/test'],
])('only displays QR for %s / %s', async (ua, paymentType, qrcode) => {
  vi.useFakeTimers()
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(ua)
  vi.spyOn(api, 'get').mockResolvedValue({ data: {} })
  const click = vi
    .spyOn(HTMLAnchorElement.prototype, 'click')
    .mockImplementation(() => {})
  render(
    <EpayQrDialog
      autoLaunch
      paymentType={paymentType}
      payment={{ trade_no: 'qr-only', qrcode }}
      onOpenChange={() => {}}
      onPaid={() => {}}
    />
  )
  await act(async () => {
    await vi.advanceTimersByTimeAsync(100)
  })
  expect(screen.getByRole('dialog').querySelector('svg')).toBeInTheDocument()
  expect(screen.queryByRole('link')).not.toBeInTheDocument()
  expect(click).not.toHaveBeenCalled()
  vi.useRealTimers()
  vi.restoreAllMocks()
})
