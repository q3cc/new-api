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
import { Loader2 } from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Dialog } from '@/components/dialog'
import { Button } from '@/components/ui/button'

import { getTopUpStatus } from '../../api'
import type { EpayMapiPayment } from '../../types'

/** How often the page asks whether the gateway has settled the order. */
const POLL_INTERVAL_MS = 3000
/** The gateway's own payment window; the code is useless after this. */
const PAYMENT_WINDOW_SECONDS = 10 * 60

type Props = {
  payment: EpayMapiPayment | null
  onOpenChange: (open: boolean) => void
  onPaid: () => void
}

/**
 * Renders a mapi payment code in place, so the reader scans it without leaving
 * the console. Settlement still happens through the gateway's notify callback;
 * this dialog only watches the order it created.
 */
export function EpayQrDialog(props: Props) {
  const { t } = useTranslation()
  const [remaining, setRemaining] = useState(PAYMENT_WINDOW_SECONDS)
  const [checking, setChecking] = useState(false)
  const paidRef = useRef(false)
  // The parent re-renders while the dialog is open, so the poll reads the
  // latest callbacks from a ref instead of restarting on every render.
  const callbacksRef = useRef({
    onPaid: props.onPaid,
    onOpenChange: props.onOpenChange,
  })
  callbacksRef.current = {
    onPaid: props.onPaid,
    onOpenChange: props.onOpenChange,
  }

  const tradeNo = props.payment?.trade_no ?? ''
  const open = !!props.payment

  useEffect(() => {
    if (!open) return
    setRemaining(PAYMENT_WINDOW_SECONDS)
    paidRef.current = false
  }, [open, tradeNo])

  useEffect(() => {
    if (!open) return
    const tick = window.setInterval(() => {
      setRemaining((seconds) => Math.max(0, seconds - 1))
    }, 1000)
    return () => window.clearInterval(tick)
  }, [open])

  useEffect(() => {
    if (!open || !tradeNo) return
    let cancelled = false
    const poll = async () => {
      if (cancelled || paidRef.current) return
      try {
        const response = await getTopUpStatus(tradeNo)
        if (cancelled || paidRef.current) return
        if (response.success && response.data?.status === 'success') {
          paidRef.current = true
          callbacksRef.current.onPaid()
          callbacksRef.current.onOpenChange(false)
        }
      } catch {
        // A transient failure just means the next tick tries again.
      }
    }
    void poll()
    const timer = window.setInterval(() => void poll(), POLL_INTERVAL_MS)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [open, tradeNo])

  const checkNow = async () => {
    if (!tradeNo) return
    setChecking(true)
    try {
      const response = await getTopUpStatus(tradeNo)
      if (response.success && response.data?.status === 'success') {
        paidRef.current = true
        callbacksRef.current.onPaid()
        callbacksRef.current.onOpenChange(false)
      }
    } finally {
      setChecking(false)
    }
  }

  const minutes = Math.floor(remaining / 60)
  const seconds = String(remaining % 60).padStart(2, '0')
  const qrValue = props.payment?.qrcode || props.payment?.pay_url || ''

  return (
    <Dialog
      open={open}
      onOpenChange={props.onOpenChange}
      title={t('Scan to pay')}
      description={t('Scan the code with your phone to complete the payment.')}
      contentHeight='auto'
      footer={
        <>
          <Button
            type='button'
            variant='outline'
            disabled={checking}
            onClick={() => void checkNow()}
          >
            {checking && <Loader2 className='mr-2 h-4 w-4 animate-spin' />}
            {t('I have paid')}
          </Button>
          <Button type='button' onClick={() => props.onOpenChange(false)}>
            {t('Close')}
          </Button>
        </>
      }
    >
      <div className='flex flex-col items-center gap-4'>
        {qrValue ? (
          <div className='rounded-xl bg-white p-4'>
            <QRCodeSVG value={qrValue} size={220} level='M' />
          </div>
        ) : (
          <p className='text-muted-foreground text-sm'>
            {t('The gateway did not return a scannable code.')}
          </p>
        )}
        {props.payment?.pay_url && props.payment.qrcode ? (
          <a
            className='text-sm underline underline-offset-4'
            href={props.payment.pay_url}
            target='_blank'
            rel='noopener noreferrer'
          >
            {t('Open the payment page instead')}
          </a>
        ) : null}
        {props.payment?.url_scheme ? (
          <a
            className='text-sm underline underline-offset-4'
            href={props.payment.url_scheme}
          >
            {t('Open the payment app')}
          </a>
        ) : null}
        <div className='text-center'>
          <p className='text-muted-foreground text-xs'>
            {t('Time remaining to pay')}
          </p>
          <p className='text-2xl font-semibold tabular-nums'>
            {minutes}:{seconds}
          </p>
        </div>
        <p className='text-muted-foreground text-xs'>
          {t('This page updates automatically once the payment is confirmed.')}
        </p>
      </div>
    </Dialog>
  )
}
