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
import { Link, useNavigate } from '@tanstack/react-router'
import { ArrowLeft, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { ConfirmDialog } from '@/components/confirm-dialog'
import { CopyButton } from '@/components/copy-button'
import { ErrorState } from '@/components/error-state'
import { SectionPageLayout } from '@/components/layout'
import { Button } from '@/components/ui/button'
import { Combobox } from '@/components/ui/combobox'
import { Skeleton } from '@/components/ui/skeleton'
import { OrderDetailDialog } from '@/features/orders/components/order-detail-dialog'
import {
  ADMIN_PERMISSION_ACTIONS,
  ADMIN_PERMISSION_RESOURCES,
  hasPermission,
} from '@/lib/admin-permissions'
import { formatTimestampToDate } from '@/lib/format'
import { handleServerError } from '@/lib/handle-server-error'
import { getServerErrorMessage } from '@/lib/server-error-message'
import { useAuthStore } from '@/stores/auth-store'

import {
  closeTicket,
  deleteTicket,
  getTicketDetail,
  reopenTicket,
  setTicketPriority,
  ticketKeys,
} from '../api'
import {
  TICKET_CATEGORY_LABEL_KEYS,
  TICKET_PRIORITIES,
  TICKET_PRIORITY_CONFIG,
} from '../constants'
import type { Ticket, TicketPriority, TicketViewer } from '../types'
import { TicketRating } from './ticket-rating'
import { TicketReplyForm } from './ticket-reply-form'
import { TicketResponseDue } from './ticket-response-due'
import { TicketStatusBadge } from './ticket-status-badge'
import { TicketThread } from './ticket-thread'

type TicketAction = 'close' | 'reopen' | 'delete'

/** One ticket with its conversation, as its owner or support sees it. */
export function TicketDetailView(props: {
  viewer: TicketViewer
  ticketId: number
}) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const user = useAuthStore((s) => s.auth.user)
  const [confirm, setConfirm] = useState<TicketAction | null>(null)
  const [orderOpen, setOrderOpen] = useState(false)
  const staff = props.viewer === 'staff'
  const canDelete =
    staff &&
    hasPermission(
      user,
      ADMIN_PERMISSION_RESOURCES.TICKET,
      ADMIN_PERMISSION_ACTIONS.DELETE
    )
  const query = useQuery({
    queryKey: ticketKeys.detail(props.viewer, props.ticketId),
    queryFn: ({ signal }) =>
      getTicketDetail(props.viewer, props.ticketId, signal),
    meta: { errorToast: false },
  })
  // Opening a ticket marks the other side's posts read on the server, so the
  // lists and sidebar counts are stale once it loads.
  useEffect(() => {
    if (!query.dataUpdatedAt) return
    void queryClient.invalidateQueries({
      queryKey: ['tickets', props.viewer, 'list'],
    })
    void queryClient.invalidateQueries({
      queryKey: staff ? ticketKeys.summary : ticketKeys.userUnread,
    })
  }, [query.dataUpdatedAt, queryClient, props.viewer, staff])
  const action = useMutation({
    mutationFn: (kind: TicketAction) => {
      if (kind === 'delete') return deleteTicket(props.ticketId)
      if (kind === 'reopen') return reopenTicket(props.ticketId)
      return closeTicket(props.viewer, props.ticketId)
    },
    meta: { errorToast: false },
    onSuccess: async (_, kind) => {
      setConfirm(null)
      if (kind === 'delete') {
        toast.success(t('Ticket deleted'))
        queryClient.removeQueries({
          queryKey: ticketKeys.detail(props.viewer, props.ticketId),
        })
        await navigate({ to: '/tickets/manage' })
        await queryClient.invalidateQueries({ queryKey: ticketKeys.all })
        return
      }
      toast.success(
        kind === 'close' ? t('Ticket closed') : t('Ticket reopened')
      )
      await queryClient.invalidateQueries({ queryKey: ticketKeys.all })
    },
    onError: (err) => handleServerError(err),
  })
  const backTo = staff ? '/tickets/manage' : '/tickets'
  const ticket = query.data?.ticket

  return (
    <>
      <SectionPageLayout>
        <SectionPageLayout.Breadcrumb>
          <Button
            variant='ghost'
            size='sm'
            className='-ml-2'
            nativeButton={false}
            render={<Link to={backTo} />}
          >
            <ArrowLeft className='size-4' aria-hidden='true' />
            {staff ? t('Ticket Management') : t('My Tickets')}
          </Button>
        </SectionPageLayout.Breadcrumb>
        <SectionPageLayout.Title>
          {ticket ? `#${ticket.id} ${ticket.title}` : t('Ticket')}
        </SectionPageLayout.Title>
        {ticket && (
          <SectionPageLayout.Actions>
            {ticket.status === 'closed' ? (
              staff && (
                <Button variant='outline' onClick={() => setConfirm('reopen')}>
                  {t('Reopen')}
                </Button>
              )
            ) : (
              <Button variant='outline' onClick={() => setConfirm('close')}>
                {t('Close ticket')}
              </Button>
            )}
            {canDelete && (
              <Button
                variant='outline'
                className='text-destructive'
                onClick={() => setConfirm('delete')}
              >
                <Trash2 className='size-4' aria-hidden='true' />
                {t('Delete')}
              </Button>
            )}
          </SectionPageLayout.Actions>
        )}
        <SectionPageLayout.Content>
          {query.isPending && (
            <div aria-label={t('Loading...')} className='space-y-3'>
              <Skeleton className='h-6 w-64' />
              <Skeleton className='h-32 w-full' />
            </div>
          )}
          {query.isError && (
            <ErrorState
              description={getServerErrorMessage(query.error)}
              onRetry={() => void query.refetch()}
            />
          )}
          {query.isSuccess && ticket && (
            <div className='mx-auto max-w-3xl space-y-6'>
              <TicketFacts
                ticket={ticket}
                staff={staff}
                onOpenOrder={() => setOrderOpen(true)}
              />
              <TicketThread
                viewer={props.viewer}
                messages={query.data.messages}
              />
              {ticket.status === 'closed' && (
                <p className='text-muted-foreground rounded-lg border border-dashed p-4 text-center text-sm'>
                  {ticket.closed_by === 'system'
                    ? t(
                        'This ticket was closed automatically after 7 days without a reply.'
                      )
                    : t('This ticket is closed.')}{' '}
                  {staff
                    ? t('Support can still add internal notes.')
                    : t('Open a new ticket if you still need help.')}
                </p>
              )}
              <TicketRating ticket={ticket} viewer={props.viewer} />
              {(ticket.status !== 'closed' || staff) && (
                <TicketReplyForm
                  key={`${ticket.id}-${ticket.status === 'closed'}`}
                  viewer={props.viewer}
                  ticketId={ticket.id}
                  notesOnly={ticket.status === 'closed'}
                />
              )}
            </div>
          )}
        </SectionPageLayout.Content>
      </SectionPageLayout>
      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(open) => {
          if (!open && !action.isPending) setConfirm(null)
        }}
        title={
          {
            close: t('Close ticket'),
            reopen: t('Reopen ticket'),
            delete: t('Delete ticket'),
          }[confirm ?? 'close']
        }
        desc={
          {
            close: t('A closed ticket takes no more replies.'),
            reopen: t('The ticket goes back to the support queue.'),
            delete: t(
              'The ticket, its messages, notes and images are deleted permanently. This cannot be undone.'
            ),
          }[confirm ?? 'close']
        }
        confirmText={
          {
            close: t('Close ticket'),
            reopen: t('Reopen'),
            delete: t('Delete'),
          }[confirm ?? 'close']
        }
        destructive={confirm !== 'reopen'}
        isLoading={action.isPending}
        handleConfirm={() => {
          if (confirm) action.mutate(confirm)
        }}
      />
      {staff && orderOpen && ticket?.topup_trade_no && (
        <OrderDetailDialog
          order={{ order_type: 'topup', trade_no: ticket.topup_trade_no }}
          onClose={() => setOrderOpen(false)}
        />
      )}
    </>
  )
}

/** Status, category, owner and the order or request the ticket is about. */
function TicketFacts(props: {
  ticket: Ticket
  staff: boolean
  onOpenOrder: () => void
}) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const ticket = props.ticket
  const priority = useMutation({
    mutationFn: (value: TicketPriority) => setTicketPriority(ticket.id, value),
    meta: { errorToast: false },
    onSuccess: async () => {
      toast.success(t('Priority updated'))
      await queryClient.invalidateQueries({ queryKey: ticketKeys.all })
    },
    onError: (err) => handleServerError(err),
  })
  return (
    <dl className='grid gap-x-6 gap-y-3 rounded-lg border p-4 text-sm sm:grid-cols-2'>
      <div className='space-y-1'>
        <dt className='text-muted-foreground'>{t('Status')}</dt>
        <dd>
          <TicketStatusBadge status={ticket.status} />
        </dd>
      </div>
      {props.staff && ticket.priority && (
        <div className='space-y-1'>
          <dt className='text-muted-foreground'>{t('Priority')}</dt>
          <dd>
            <Combobox
              aria-label={t('Priority')}
              className='w-40'
              disabled={priority.isPending}
              options={TICKET_PRIORITIES.map((value) => ({
                value: value as string,
                label: t(TICKET_PRIORITY_CONFIG[value].labelKey),
              }))}
              value={ticket.priority}
              onValueChange={(value: string | null) => {
                if (value && value !== ticket.priority) {
                  priority.mutate(value as TicketPriority)
                }
              }}
            />
          </dd>
        </div>
      )}
      {props.staff && ticket.status === 'open' && (
        <div className='space-y-1'>
          <dt className='text-muted-foreground'>{t('Response due')}</dt>
          <dd>
            <TicketResponseDue dueAt={ticket.response_due_at} />
          </dd>
        </div>
      )}
      <div className='space-y-1'>
        <dt className='text-muted-foreground'>{t('Category')}</dt>
        <dd>{t(TICKET_CATEGORY_LABEL_KEYS[ticket.category])}</dd>
      </div>
      {props.staff && (
        <div className='space-y-1'>
          <dt className='text-muted-foreground'>{t('User')}</dt>
          <dd>
            <Link
              to='/tickets/manage'
              search={{ user_id: ticket.user_id }}
              className='underline-offset-4 hover:underline'
            >
              {ticket.username || '—'} (#{ticket.user_id})
            </Link>
          </dd>
        </div>
      )}
      <div className='space-y-1'>
        <dt className='text-muted-foreground'>{t('Created At')}</dt>
        <dd>{formatTimestampToDate(ticket.created_at)}</dd>
      </div>
      {props.staff && ticket.first_replied_at > 0 && (
        <div className='space-y-1'>
          <dt className='text-muted-foreground'>{t('First response')}</dt>
          <dd>{formatTimestampToDate(ticket.first_replied_at)}</dd>
        </div>
      )}
      {ticket.topup_trade_no && (
        <div className='min-w-0 space-y-1'>
          <dt className='text-muted-foreground'>{t('Order Number')}</dt>
          <dd className='flex min-w-0 items-center gap-1'>
            {props.staff ? (
              <Button
                variant='link'
                className='h-auto min-w-0 truncate p-0 font-mono'
                onClick={props.onOpenOrder}
              >
                {ticket.topup_trade_no}
              </Button>
            ) : (
              <span className='min-w-0 truncate font-mono'>
                {ticket.topup_trade_no}
              </span>
            )}
            <CopyButton value={ticket.topup_trade_no} size='sm' />
          </dd>
        </div>
      )}
      {ticket.request_id && (
        <div className='min-w-0 space-y-1'>
          <dt className='text-muted-foreground'>{t('Request ID')}</dt>
          <dd className='flex min-w-0 items-center gap-1'>
            {props.staff ? (
              <Link
                to='/usage-logs/$section'
                params={{ section: 'common' }}
                search={{ requestId: ticket.request_id }}
                className='min-w-0 truncate font-mono underline-offset-4 hover:underline'
              >
                {ticket.request_id}
              </Link>
            ) : (
              <span className='min-w-0 truncate font-mono'>
                {ticket.request_id}
              </span>
            )}
            <CopyButton value={ticket.request_id} size='sm' />
          </dd>
        </div>
      )}
    </dl>
  )
}
