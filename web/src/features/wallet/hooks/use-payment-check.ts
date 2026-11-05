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
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { handleServerError } from '@/lib/handle-server-error'
import { createServerError } from '@/lib/server-error-message'

import { queryPaymentOrder } from '../api'
import type { TopupStatus } from '../types'

/**
 * Asks the payment gateway whether an order has been paid, for a payer who
 * says they paid. Every outcome but a settled order is reported here; the
 * caller reports a settled order in its own words.
 */
export function usePaymentCheck() {
  const { t } = useTranslation()
  const [checkingTradeNo, setCheckingTradeNo] = useState('')

  const check = useCallback(
    async (tradeNo: string): Promise<TopupStatus | undefined> => {
      const checkFailed = t(
        'Could not check the payment status. Please try again.'
      )
      setCheckingTradeNo(tradeNo)
      try {
        const response = await queryPaymentOrder(tradeNo)
        if (!response.success || !response.data) {
          throw createServerError(response, checkFailed)
        }
        const status = response.data.status
        if (status === 'expired') {
          toast.error(t('This order has expired. Please place a new order.'))
        } else if (status === 'failed') {
          toast.error(t('This payment failed. Please place a new order.'))
        } else if (status !== 'success') {
          toast.info(
            t(
              'Payment not received yet. If you have paid, wait a moment and check again.'
            )
          )
        }
        return status
      } catch (error) {
        handleServerError(error, checkFailed)
        return undefined
      } finally {
        setCheckingTradeNo('')
      }
    },
    [t]
  )

  return { checkingTradeNo, check }
}
