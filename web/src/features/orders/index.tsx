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
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getRouteApi } from '@tanstack/react-router'
import type { ColumnDef } from '@tanstack/react-table'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { ConfirmDialog } from '@/components/confirm-dialog'
import { CopyButton } from '@/components/copy-button'
import { DataTablePage, useDataTable } from '@/components/data-table'
import { ErrorState } from '@/components/error-state'
import { SectionPageLayout } from '@/components/layout'
import { StatusBadge } from '@/components/status-badge'
import { Button } from '@/components/ui/button'
import { Combobox } from '@/components/ui/combobox'
import { Input } from '@/components/ui/input'
import { CompactDateTimeRangePicker } from '@/features/usage-logs/components/compact-date-time-range-picker'
import { completeOrder } from '@/features/wallet/api'
import {
  formatTimestamp,
  getPaymentMethodName,
  getStatusConfig,
} from '@/features/wallet/lib/billing'
import { useDebounce } from '@/hooks/use-debounce'
import { useTableUrlState, type NavigateFn } from '@/hooks/use-table-url-state'
import { toIntlLocale } from '@/i18n/languages'
import { formatCurrencyFromUSD } from '@/lib/currency'
import { formatNumber } from '@/lib/format'
import {
  getServerErrorMessage,
  requireServerSuccess,
} from '@/lib/server-error-message'

import {
  getOrders,
  getOrderFilters,
  ordersSearchSchema,
  type OrdersSearch,
  type AdminOrder,
} from './api'
import { OrderDetailDialog } from './components/order-detail-dialog'

const route = getRouteApi('/_authenticated/orders/')
export function Orders() {
  return (
    <OrdersPage search={route.useSearch()} navigate={route.useNavigate()} />
  )
}

export function OrdersPage(props: {
  search: OrdersSearch
  navigate: NavigateFn
}) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const queryClient = useQueryClient()
  const [selected, setSelected] = useState<AdminOrder | null>(null)
  const [confirmOrder, setConfirmOrder] = useState<AdminOrder | null>(null)
  const { pagination, onPaginationChange, ensurePageInRange } =
    useTableUrlState({
      search: props.search,
      navigate: props.navigate,
      globalFilter: { enabled: false },
      pagination: { defaultPageSize: 20 },
    })
  const keyword = useDebounce(props.search.keyword ?? '')
  const dateInvalid =
    props.search.start_timestamp !== undefined &&
    props.search.end_timestamp !== undefined &&
    props.search.start_timestamp > props.search.end_timestamp
  const params = {
    ...props.search,
    keyword,
    page: pagination.pageIndex + 1,
    pageSize: pagination.pageSize,
  }
  const query = useQuery({
    queryKey: ['admin-orders', params],
    queryFn: ({ signal }) => getOrders(params, signal),
    enabled: !dateInvalid && keyword === (props.search.keyword ?? ''),
    meta: { errorToast: false },
  })
  const filters = useQuery({
    queryKey: ['admin-order-filters'],
    queryFn: ({ signal }) => getOrderFilters(signal),
    meta: { errorToast: false },
  })
  const complete = useMutation({
    mutationFn: async (order: AdminOrder) =>
      requireServerSuccess(await completeOrder({ trade_no: order.trade_no })),
    meta: { errorToast: false },
    onSuccess: async () => {
      setConfirmOrder(null)
      toast.success(t('Order completed successfully'))
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['admin-orders'] }),
        queryClient.invalidateQueries({ queryKey: ['admin-order-detail'] }),
      ])
    },
  })
  const openComplete = (order: AdminOrder) => {
    complete.reset()
    setConfirmOrder(order)
  }
  const changeFilters = (patch: Partial<OrdersSearch>) =>
    props.navigate({
      search: (prev) =>
        ordersSearchSchema.parse({ ...prev, ...patch, page: 1 }),
      replace: true,
    })
  const columns: ColumnDef<AdminOrder, unknown>[] = [
    {
      accessorKey: 'trade_no',
      header: t('Order Number'),
      cell: ({ row }) => (
        <div className='flex min-w-0 items-center gap-1'>
          <Button
            variant='link'
            className='h-auto max-w-64 truncate p-0 font-mono'
            onClick={() => setSelected(row.original)}
          >
            {row.original.trade_no}
          </Button>
          <CopyButton value={row.original.trade_no} size='sm' />
        </div>
      ),
    },
    {
      accessorKey: 'user_id',
      header: t('User'),
      cell: ({ row }) => (
        <div>
          <span>#{row.original.user_id ?? '—'}</span>
          <div className='text-muted-foreground max-w-40 truncate text-xs'>
            {row.original.username || '—'}
          </div>
        </div>
      ),
    },
    {
      accessorKey: 'order_type',
      header: t('Order type'),
      cell: ({ row }) =>
        row.original.order_type === 'subscription'
          ? t('Subscription')
          : t('Top-up'),
    },
    {
      id: 'benefit',
      header: t('Amount / Plan'),
      cell: ({ row }) =>
        row.original.order_type === 'subscription'
          ? row.original.plan_title || '—'
          : formatCurrencyFromUSD(row.original.amount, {
              digitsLarge: 2,
              digitsSmall: 2,
              abbreviate: false,
            }),
    },
    {
      accessorKey: 'money',
      header: t('Payment'),
      cell: ({ row }) => formatNumber(row.original.money, locale),
    },
    {
      accessorKey: 'payment_method',
      header: t('Payment Method'),
      cell: ({ row }) => getPaymentMethodName(row.original.payment_method, t),
    },
    {
      accessorKey: 'status',
      header: t('Status'),
      cell: ({ row }) => {
        const config = getStatusConfig(row.original.status)
        return (
          <StatusBadge
            label={t(config.label)}
            variant={config.variant}
            copyable={false}
          />
        )
      },
    },
    {
      accessorKey: 'create_time',
      header: t('Created At'),
      cell: ({ row }) => formatTimestamp(row.original.create_time),
    },
    {
      id: 'actions',
      header: t('Actions'),
      cell: ({ row }) => (
        <div className='flex gap-1'>
          <Button
            size='sm'
            variant='ghost'
            onClick={() => setSelected(row.original)}
          >
            {t('Details')}
          </Button>
          {row.original.status === 'pending' && (
            <Button
              size='sm'
              variant='outline'
              disabled={complete.isPending}
              onClick={() => openComplete(row.original)}
            >
              {t('Complete Order')}
            </Button>
          )}
        </div>
      ),
    },
  ]
  const { table } = useDataTable({
    data: query.data?.items ?? [],
    columns,
    pagination,
    onPaginationChange,
    ensurePageInRange,
    totalCount: query.data?.total ?? 0,
    manualFiltering: true,
    manualPagination: true,
    manualSorting: true,
    enableSorting: false,
    enableRowSelection: false,
    getRowId: (row) => `${row.order_type ?? 'topup'}:${row.trade_no}`,
  })
  const paymentMethods = [
    ...new Set([
      ...(filters.data?.payment_methods ?? []),
      ...(props.search.payment_method ? [props.search.payment_method] : []),
    ]),
  ]
  const filterFields = [
    {
      key: 'order_type' as const,
      label: t('Order type'),
      options: [
        { value: 'topup', label: t('Top-up') },
        { value: 'subscription', label: t('Subscription') },
      ],
    },
    {
      key: 'status' as const,
      label: t('Status'),
      options: ['pending', 'success', 'failed', 'expired'].map((value) => ({
        value,
        label: t(getStatusConfig(value as AdminOrder['status']).label),
      })),
    },
    {
      key: 'payment_method' as const,
      label: t('Payment Method'),
      options: paymentMethods.map((value) => ({
        value,
        label: getPaymentMethodName(value, t),
      })),
    },
  ]
  const toolbar = (
    <div className='space-y-2'>
      <div className='flex flex-wrap gap-2'>
        <Input
          aria-label={t('Search orders')}
          placeholder={t(
            'Search by order number, user ID, username, nickname or email...'
          )}
          value={props.search.keyword ?? ''}
          maxLength={255}
          onChange={(event) => changeFilters({ keyword: event.target.value })}
          className='min-w-52 flex-1'
        />
        {filterFields.map((field) => (
          <Combobox
            key={field.key}
            aria-label={field.label}
            className='w-full sm:w-40'
            options={[{ value: '', label: field.label }, ...field.options]}
            value={props.search[field.key] ?? ''}
            onValueChange={(value) =>
              changeFilters({ [field.key]: value || undefined })
            }
          />
        ))}
        <CompactDateTimeRangePicker
          start={
            props.search.start_timestamp === undefined
              ? undefined
              : new Date(props.search.start_timestamp * 1000)
          }
          end={
            props.search.end_timestamp === undefined
              ? undefined
              : new Date(props.search.end_timestamp * 1000)
          }
          onChange={({ start, end }) =>
            changeFilters({
              start_timestamp: start
                ? Math.floor(start.getTime() / 1000)
                : undefined,
              end_timestamp: end ? Math.floor(end.getTime() / 1000) : undefined,
            })
          }
          className='w-full sm:w-auto'
        />
        <Button
          variant='outline'
          onClick={() =>
            props.navigate({
              search: { page: 1, pageSize: pagination.pageSize },
              replace: true,
            })
          }
        >
          {t('Reset')}
        </Button>
        <Button
          variant='outline'
          disabled={query.isFetching || dateInvalid}
          onClick={() => void query.refetch()}
        >
          {t('Refresh')}
        </Button>
      </div>
      {dateInvalid && (
        <p role='alert' className='text-destructive text-sm'>
          {t('Start time must not be after end time')}
        </p>
      )}
      {filters.isError && (
        <div role='alert' className='flex items-center gap-2 text-sm'>
          <span>{getServerErrorMessage(filters.error)}</span>
          <Button variant='link' onClick={() => void filters.refetch()}>
            {t('Retry')}
          </Button>
        </div>
      )}
    </div>
  )
  return (
    <>
      <SectionPageLayout fixedContent>
        <SectionPageLayout.Title>{t('Orders')}</SectionPageLayout.Title>
        <SectionPageLayout.Content>
          {query.isError ? (
            <div className='space-y-4'>
              {toolbar}
              <ErrorState
                description={getServerErrorMessage(query.error)}
                onRetry={() => void query.refetch()}
              />
            </div>
          ) : (
            <DataTablePage
              table={table}
              columns={columns}
              toolbar={toolbar}
              isLoading={query.isPending && !dateInvalid}
              isFetching={query.isFetching}
              emptyTitle={t('No billing records found')}
              mobileProps={{ enableRowSelection: false }}
            />
          )}
        </SectionPageLayout.Content>
      </SectionPageLayout>
      {selected && (
        <OrderDetailDialog
          order={selected}
          onClose={() => setSelected(null)}
          onComplete={openComplete}
          completing={complete.isPending}
        />
      )}
      <ConfirmDialog
        open={!!confirmOrder}
        onOpenChange={(open) => {
          if (!open && !complete.isPending) setConfirmOrder(null)
        }}
        title={t('Complete Order')}
        desc={
          confirmOrder?.order_type === 'subscription'
            ? t(
                'Complete this order and activate the subscription plan for the user?'
              )
            : t(
                'Complete this order and credit the corresponding balance to the user?'
              )
        }
        confirmText={t('Confirm')}
        isLoading={complete.isPending}
        handleConfirm={() => {
          if (confirmOrder && !complete.isPending) complete.mutate(confirmOrder)
        }}
      >
        {confirmOrder && (
          <p className='font-mono text-sm break-all'>{confirmOrder.trade_no}</p>
        )}
        {complete.isError && (
          <p role='alert' className='text-destructive text-sm'>
            {getServerErrorMessage(complete.error)}
          </p>
        )}
      </ConfirmDialog>
    </>
  )
}
