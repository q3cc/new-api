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
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'

import { CopyButton } from '@/components/copy-button'
import { Dialog } from '@/components/dialog'
import { ErrorState } from '@/components/error-state'
import { StatusBadge } from '@/components/status-badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  getPaymentMethodName,
  getStatusConfig,
  formatTimestamp,
} from '@/features/wallet/lib/billing'
import { toIntlLocale } from '@/i18n/languages'
import { formatCurrencyFromUSD } from '@/lib/currency'
import { formatNumber } from '@/lib/format'
import { getServerErrorMessage } from '@/lib/server-error-message'

import { getOrderDetail, type AdminOrder } from '../api'

export function OrderDetailDialog(props: {
  order: AdminOrder
  onClose: () => void
  onComplete: (order: AdminOrder) => void
  completing: boolean
}) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const query = useQuery({
    queryKey: [
      'admin-order-detail',
      props.order.order_type,
      props.order.trade_no,
    ],
    queryFn: ({ signal }) => getOrderDetail(props.order, signal),
    staleTime: 0,
    meta: { errorToast: false },
  })
  const order = query.data
  const fields = order
    ? [
        [t('Order Number'), order.trade_no],
        [t('User ID'), String(order.user_id ?? '—')],
        [t('Username'), order.username || '—'],
        [t('Nickname'), order.display_name || '—'],
        [t('Email'), order.email || '—'],
        [
          t('Order type'),
          order.order_type === 'subscription' ? t('Subscription') : t('Top-up'),
        ],
        [
          order.order_type === 'subscription'
            ? t('Subscription plan')
            : t('Amount'),
          order.order_type === 'subscription'
            ? (order.plan_title || '—') +
              (order.plan_id ? ' (#' + order.plan_id + ')' : '')
            : formatCurrencyFromUSD(order.amount, {
                digitsLarge: 2,
                digitsSmall: 2,
                abbreviate: false,
              }),
        ],
        [t('Payment'), formatNumber(order.money, locale)],
        [t('Payment Method'), getPaymentMethodName(order.payment_method, t)],
        [t('Payment provider'), order.payment_provider || '—'],
        [
          t('Payment service'),
          order.payment_service_name
            ? order.payment_service_name +
              (order.payment_service_id
                ? ' (' + order.payment_service_id + ')'
                : '')
            : order.payment_service_id || '—',
        ],
        [t('Created At'), formatTimestamp(order.create_time)],
        [
          t('Completed at'),
          order.complete_time ? formatTimestamp(order.complete_time) : '—',
        ],
      ]
    : []
  const status = order ? getStatusConfig(order.status) : undefined
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) props.onClose()
      }}
      title={t('Order details')}
      contentClassName='sm:max-w-2xl'
      footer={
        order?.status === 'pending' ? (
          <Button
            disabled={props.completing}
            onClick={() => props.onComplete(order)}
          >
            {t('Complete Order')}
          </Button>
        ) : undefined
      }
    >
      {query.isPending && (
        <div aria-label={t('Loading...')} className='space-y-3'>
          <Skeleton className='h-6 w-48' />
          <Skeleton className='h-40 w-full' />
        </div>
      )}
      {query.isError && (
        <ErrorState
          description={getServerErrorMessage(query.error)}
          onRetry={() => void query.refetch()}
        />
      )}
      {query.isSuccess && (
        <>
          {status && (
            <StatusBadge
              label={t(status.label)}
              variant={status.variant}
              copyable={false}
            />
          )}
          <dl className='mt-4 grid gap-4 sm:grid-cols-2'>
            {fields.map(([label, value]) => (
              <div key={label} className='min-w-0 space-y-1'>
                <dt className='text-muted-foreground text-sm'>{label}</dt>
                <dd className='flex items-start gap-2 text-sm font-medium break-all'>
                  {value}
                  {label === t('Order Number') && (
                    <CopyButton value={value} size='sm' />
                  )}
                </dd>
              </div>
            ))}
          </dl>
        </>
      )}
    </Dialog>
  )
}
