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
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { LifeBuoy, ScrollText, Users } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { CopyButton } from '@/components/copy-button'
import { GroupBadge } from '@/components/group-badge'
import { StatusBadge } from '@/components/status-badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { getOrders, type AdminOrder } from '@/features/orders/api'
import { OrderDetailDialog } from '@/features/orders/components/order-detail-dialog'
import { UserSubscriptionsDialog } from '@/features/subscriptions/components/dialogs/user-subscriptions-dialog'
import { getTicketQueue } from '@/features/tickets/api'
import { formatTimestamp, getStatusConfig } from '@/features/wallet/lib/billing'
import { toIntlLocale } from '@/i18n/languages'
import {
  ADMIN_PERMISSION_ACTIONS,
  ADMIN_PERMISSION_RESOURCES,
  hasPermission,
} from '@/lib/admin-permissions'
import { formatCurrencyFromUSD } from '@/lib/currency'
import { formatNumber } from '@/lib/format'
import {
  getServerErrorMessage,
  requireServerSuccess,
} from '@/lib/server-error-message'
import { useAuthStore } from '@/stores/auth-store'

import { getUser, getUserGiftQuota } from '../api'
import {
  USER_ROLES,
  USER_STATUS,
  USER_STATUSES,
  isUserDeleted,
} from '../constants'
import type { User } from '../types'
import { UserQuotaCell } from './user-quota-cell'
import { UserQuotaDialog } from './user-quota-dialog'

const RECENT_ORDER_COUNT = 5
const QUICK_LINK_CLASS =
  'text-primary inline-flex w-fit items-center gap-1.5 underline-offset-4 hover:underline'

/** Query keys of one user's overview; invalidate the root after a change. */
const userOverviewKeys = {
  root: (userId: number) => ['user-overview', userId] as const,
  user: (userId: number) => ['user-overview', userId, 'user'] as const,
  gift: (userId: number) => ['user-overview', userId, 'gift'] as const,
  orders: (userId: number) => ['user-overview', userId, 'orders'] as const,
  tickets: (userId: number) => ['user-overview', userId, 'tickets'] as const,
}

/**
 * What support needs at hand about one user: account, balance with gift
 * credit, recent orders, and links to the user's logs, tickets and orders.
 */
export function UserOverview(props: {
  userId: number
  /** False on the users page, which the overview would link back to. */
  showUsersLink?: boolean
  /** Called after the balance or subscriptions change here. */
  onChanged?: () => void
}) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const queryClient = useQueryClient()
  const viewer = useAuthStore((s) => s.auth.user)
  const canReadTickets = hasPermission(
    viewer,
    ADMIN_PERMISSION_RESOURCES.TICKET,
    ADMIN_PERMISSION_ACTIONS.READ
  )
  const [dialog, setDialog] = useState<'quota' | 'subscriptions' | null>(null)
  const [order, setOrder] = useState<AdminOrder | null>(null)
  // Admins may not load users of their own level or above; the orders and
  // tickets below still load for them.
  const user = useQuery({
    queryKey: userOverviewKeys.user(props.userId),
    queryFn: async () => {
      const response = requireServerSuccess(await getUser(props.userId))
      return response.data as User
    },
    meta: { errorToast: false },
  })
  const gift = useQuery({
    queryKey: userOverviewKeys.gift(props.userId),
    queryFn: async () =>
      requireServerSuccess(await getUserGiftQuota(props.userId)).data,
    enabled: user.isSuccess,
    meta: { errorToast: false },
  })
  const orders = useQuery({
    queryKey: userOverviewKeys.orders(props.userId),
    queryFn: ({ signal }) =>
      getOrders(
        { user_id: props.userId, page: 1, pageSize: RECENT_ORDER_COUNT },
        signal
      ),
    meta: { errorToast: false },
  })
  const tickets = useQuery({
    queryKey: userOverviewKeys.tickets(props.userId),
    queryFn: ({ signal }) =>
      getTicketQueue({ user_id: props.userId, page: 1, pageSize: 1 }, signal),
    enabled: canReadTickets,
    meta: { errorToast: false },
  })
  const refresh = async () => {
    await queryClient.invalidateQueries({
      queryKey: userOverviewKeys.root(props.userId),
    })
    props.onChanged?.()
  }
  const account = user.data

  return (
    <div className='space-y-5 text-sm'>
      {user.isPending && (
        <div aria-label={t('Loading...')} className='space-y-2'>
          <Skeleton className='h-5 w-40' />
          <Skeleton className='h-20 w-full' />
        </div>
      )}
      {user.isError && (
        <div className='space-y-2 rounded-md border border-dashed p-3'>
          <p className='text-muted-foreground'>
            {getServerErrorMessage(user.error)}
          </p>
          <Button
            variant='outline'
            size='sm'
            onClick={() => void user.refetch()}
          >
            {t('Retry')}
          </Button>
        </div>
      )}
      {account && (
        <>
          <UserAccount user={account} />
          <section className='space-y-2'>
            <h4 className='text-muted-foreground text-xs font-medium'>
              {t('Available Balance')}
            </h4>
            <UserQuotaCell
              remaining={account.quota}
              used={account.used_quota}
              gift={gift.data}
            />
            <div className='flex flex-wrap gap-2'>
              <Button
                variant='outline'
                size='sm'
                onClick={() => setDialog('quota')}
              >
                {t('Adjust Quota')}
              </Button>
              <Button
                variant='outline'
                size='sm'
                onClick={() => setDialog('subscriptions')}
              >
                {t('Manage Subscriptions')}
              </Button>
            </div>
          </section>
        </>
      )}

      <section className='space-y-2'>
        <div className='flex items-center justify-between gap-2'>
          <h4 className='text-muted-foreground text-xs font-medium'>
            {t('Recent orders')}
          </h4>
          <Link
            to='/orders'
            search={{ user_id: props.userId }}
            className='text-xs underline-offset-4 hover:underline'
          >
            {t('All orders')}
          </Link>
        </div>
        {orders.isPending && <Skeleton className='h-16 w-full' />}
        {orders.isError && (
          <div className='text-muted-foreground flex items-center gap-2 text-xs'>
            <span>{getServerErrorMessage(orders.error)}</span>
            <Button
              variant='link'
              size='sm'
              className='h-auto p-0'
              onClick={() => void orders.refetch()}
            >
              {t('Retry')}
            </Button>
          </div>
        )}
        {orders.data && orders.data.items.length === 0 && (
          <p className='text-muted-foreground text-xs'>{t('No orders yet')}</p>
        )}
        {orders.data && orders.data.items.length > 0 && (
          <ul className='divide-y rounded-md border'>
            {orders.data.items.map((item) => {
              const status = getStatusConfig(item.status)
              return (
                <li key={`${item.order_type}-${item.trade_no}`}>
                  <Button
                    variant='ghost'
                    className='h-auto w-full justify-between gap-2 rounded-none px-3 py-2 text-left font-normal'
                    onClick={() => setOrder(item)}
                  >
                    <span className='min-w-0'>
                      <span className='block truncate font-mono text-xs'>
                        {item.trade_no}
                      </span>
                      <span className='text-muted-foreground block text-xs'>
                        {formatTimestamp(item.create_time)}
                      </span>
                    </span>
                    <span className='flex shrink-0 flex-col items-end gap-1'>
                      <span className='text-xs tabular-nums'>
                        {item.order_type === 'subscription'
                          ? item.plan_title || t('Subscription')
                          : formatCurrencyFromUSD(item.amount, {
                              digitsLarge: 2,
                              digitsSmall: 2,
                              abbreviate: false,
                            })}
                      </span>
                      <StatusBadge
                        label={t(status.label)}
                        variant={status.variant}
                        copyable={false}
                      />
                    </span>
                  </Button>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      <nav aria-label={t('Quick links')} className='flex flex-col gap-2'>
        {account && (
          <Link
            to='/usage-logs/$section'
            params={{ section: 'common' }}
            search={{ username: account.username }}
            className={QUICK_LINK_CLASS}
          >
            <ScrollText className='size-4' aria-hidden='true' />
            {t('Usage Logs')}
          </Link>
        )}
        {canReadTickets && (
          <Link
            to='/tickets/manage'
            search={{ user_id: props.userId }}
            className={QUICK_LINK_CLASS}
          >
            <LifeBuoy className='size-4' aria-hidden='true' />
            {tickets.data
              ? t('Tickets ({{count}})', {
                  count: formatNumber(tickets.data.total, locale),
                })
              : t('Tickets')}
          </Link>
        )}
        {/* The users search also matches digits inside names, so the
            login name finds the account more precisely than its id. */}
        {account && props.showUsersLink !== false && (
          <Link
            to='/users'
            search={{ filter: account.username }}
            className={QUICK_LINK_CLASS}
          >
            <Users className='size-4' aria-hidden='true' />
            {t('Open in user management')}
          </Link>
        )}
      </nav>

      {account && (
        <UserQuotaDialog
          open={dialog === 'quota'}
          onOpenChange={(open) => setDialog(open ? 'quota' : null)}
          userId={account.id}
          currentQuota={account.quota}
          onSuccess={() => void refresh()}
        />
      )}
      <UserSubscriptionsDialog
        open={dialog === 'subscriptions'}
        onOpenChange={(open) => setDialog(open ? 'subscriptions' : null)}
        user={account ? { id: account.id, username: account.username } : null}
        onSuccess={() => void refresh()}
      />
      {order && (
        <OrderDetailDialog order={order} onClose={() => setOrder(null)} />
      )}
    </div>
  )
}

/** Name, status, role, group and contact of the account. */
function UserAccount(props: { user: User }) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const user = props.user
  const deleted = isUserDeleted(user)
  const status = deleted
    ? USER_STATUSES[USER_STATUS.DELETED]
    : USER_STATUSES[user.status as keyof typeof USER_STATUSES]
  const role = USER_ROLES[user.role as keyof typeof USER_ROLES]
  const rows: [string, ReactNode][] = [
    [t('Role'), role ? t(role.labelKey) : '—'],
    [t('User Group'), <GroupBadge key='group' group={user.group} />],
    [
      t('Email'),
      user.email ? (
        <span key='email' className='flex min-w-0 items-center gap-1'>
          <span className='truncate'>{user.email}</span>
          <CopyButton value={user.email} size='sm' />
        </span>
      ) : (
        '—'
      ),
    ],
    [t('Request Count'), formatNumber(user.request_count, locale)],
    [
      t('Registered at'),
      user.created_at ? formatTimestamp(user.created_at) : '—',
    ],
    [
      t('Last Login'),
      user.last_login_at ? formatTimestamp(user.last_login_at) : '—',
    ],
  ]

  return (
    <section className='space-y-3'>
      <div className='flex items-start justify-between gap-2'>
        <div className='min-w-0'>
          <div className='truncate font-medium'>
            {user.display_name || user.username}
          </div>
          <div className='text-muted-foreground flex min-w-0 items-center gap-1 text-xs'>
            <span className='truncate'>{user.username}</span>
            <span className='shrink-0'>· #{user.id}</span>
            <CopyButton value={user.username} size='sm' />
          </div>
        </div>
        {status && (
          <StatusBadge
            label={t(status.labelKey)}
            variant={deleted ? 'neutral' : status.variant}
            copyable={false}
          />
        )}
      </div>
      <dl className='grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5'>
        {rows.map(([label, value]) => (
          <div key={label} className='contents'>
            <dt className='text-muted-foreground'>{label}</dt>
            <dd className='min-w-0'>{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}
