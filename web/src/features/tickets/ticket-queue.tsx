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
import type { ColumnDef } from '@tanstack/react-table'
import { MessageSquareText, Timer } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { DataTablePage, useDataTable } from '@/components/data-table'
import { ErrorState } from '@/components/error-state'
import { SectionPageLayout } from '@/components/layout'
import { Button } from '@/components/ui/button'
import { Combobox } from '@/components/ui/combobox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { useDebounce } from '@/hooks/use-debounce'
import { useTableUrlState, type NavigateFn } from '@/hooks/use-table-url-state'
import {
  ADMIN_PERMISSION_ACTIONS,
  ADMIN_PERMISSION_RESOURCES,
  hasPermission,
} from '@/lib/admin-permissions'
import { formatTimestampToDate } from '@/lib/format'
import { getServerErrorMessage } from '@/lib/server-error-message'
import { useAuthStore } from '@/stores/auth-store'

import {
  getTicketQueue,
  ticketKeys,
  ticketQueueSearchSchema,
  type TicketQueueSearch,
} from './api'
import { CannedRepliesDialog } from './components/canned-replies-dialog'
import { TicketResponseDue } from './components/ticket-response-due'
import { TicketSlaDialog } from './components/ticket-sla-dialog'
import {
  TicketPriorityBadge,
  TicketStatusBadge,
} from './components/ticket-status-badge'
import { TicketTitleLink } from './components/ticket-title-link'
import {
  TICKET_CATEGORIES,
  TICKET_CATEGORY_LABEL_KEYS,
  TICKET_PRIORITIES,
  TICKET_PRIORITY_CONFIG,
  TICKET_STATUS_CONFIG,
  TICKET_STATUSES,
} from './constants'
import type { Ticket } from './types'

/** The support queue: every user's tickets, most recently active first. */
export function TicketQueuePage(props: {
  search: TicketQueueSearch
  navigate: NavigateFn
}) {
  const { t } = useTranslation()
  const user = useAuthStore((s) => s.auth.user)
  const canManage = hasPermission(
    user,
    ADMIN_PERMISSION_RESOURCES.TICKET,
    ADMIN_PERMISSION_ACTIONS.MANAGE
  )
  const [dialog, setDialog] = useState<'sla' | 'canned' | null>(null)
  const { pagination, onPaginationChange, ensurePageInRange } =
    useTableUrlState({
      search: props.search,
      navigate: props.navigate,
      globalFilter: { enabled: false },
      pagination: { defaultPageSize: 20 },
    })
  const keyword = useDebounce(props.search.keyword ?? '')
  const search = {
    ...props.search,
    keyword,
    page: pagination.pageIndex + 1,
    pageSize: pagination.pageSize,
  }
  const query = useQuery({
    queryKey: ticketKeys.queue(search),
    queryFn: ({ signal }) => getTicketQueue(search, signal),
    enabled: keyword === (props.search.keyword ?? ''),
    meta: { errorToast: false },
  })
  const changeFilters = (patch: Partial<TicketQueueSearch>) =>
    props.navigate({
      search: (prev) =>
        ticketQueueSearchSchema.parse({ ...prev, ...patch, page: 1 }),
      replace: true,
    })
  const columns: ColumnDef<Ticket, unknown>[] = [
    {
      accessorKey: 'title',
      header: t('Ticket'),
      cell: ({ row }) => (
        <TicketTitleLink ticket={row.original} viewer='staff' />
      ),
    },
    {
      accessorKey: 'priority',
      header: t('Priority'),
      cell: ({ row }) =>
        row.original.priority ? (
          <TicketPriorityBadge priority={row.original.priority} />
        ) : null,
    },
    {
      accessorKey: 'user_id',
      header: t('User'),
      cell: ({ row }) => (
        <div>
          <span>#{row.original.user_id}</span>
          <div className='text-muted-foreground max-w-40 truncate text-xs'>
            {row.original.username || '—'}
          </div>
        </div>
      ),
    },
    {
      accessorKey: 'category',
      header: t('Category'),
      cell: ({ row }) => t(TICKET_CATEGORY_LABEL_KEYS[row.original.category]),
    },
    {
      accessorKey: 'status',
      header: t('Status'),
      cell: ({ row }) => <TicketStatusBadge status={row.original.status} />,
    },
    {
      accessorKey: 'response_due_at',
      header: t('Response due'),
      cell: ({ row }) => (
        <TicketResponseDue dueAt={row.original.response_due_at} />
      ),
    },
    {
      accessorKey: 'updated_at',
      header: t('Last activity'),
      cell: ({ row }) => formatTimestampToDate(row.original.updated_at),
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
    getRowId: (row) => String(row.id),
  })
  const toolbar = (
    <div className='flex flex-wrap items-center gap-2'>
      <Input
        aria-label={t('Search tickets')}
        placeholder={t('Search by ticket ID or title...')}
        value={props.search.keyword ?? ''}
        maxLength={128}
        onChange={(event) => changeFilters({ keyword: event.target.value })}
        className='min-w-52 flex-1'
      />
      <Combobox
        aria-label={t('Status')}
        className='w-full sm:w-44'
        options={[
          { value: '', label: t('All statuses') },
          ...TICKET_STATUSES.map((status) => ({
            value: status,
            label: t(TICKET_STATUS_CONFIG[status].labelKey),
          })),
        ]}
        value={props.search.status ?? ''}
        onValueChange={(value) =>
          changeFilters({ status: (value || undefined) as Ticket['status'] })
        }
      />
      <Combobox
        aria-label={t('Category')}
        className='w-full sm:w-44'
        options={[
          { value: '', label: t('All categories') },
          ...TICKET_CATEGORIES.map((category) => ({
            value: category,
            label: t(TICKET_CATEGORY_LABEL_KEYS[category]),
          })),
        ]}
        value={props.search.category ?? ''}
        onValueChange={(value) =>
          changeFilters({
            category: (value || undefined) as Ticket['category'],
          })
        }
      />
      <Combobox
        aria-label={t('Priority')}
        className='w-full sm:w-36'
        options={[
          { value: '', label: t('All priorities') },
          ...TICKET_PRIORITIES.map((priority) => ({
            value: priority,
            label: t(TICKET_PRIORITY_CONFIG[priority].labelKey),
          })),
        ]}
        value={props.search.priority ?? ''}
        onValueChange={(value) =>
          changeFilters({
            priority: (value || undefined) as TicketQueueSearch['priority'],
          })
        }
      />
      <div className='flex items-center gap-2'>
        <Switch
          id='ticket-queue-overdue'
          checked={props.search.overdue ?? false}
          onCheckedChange={(checked) =>
            changeFilters({ overdue: checked || undefined })
          }
        />
        <Label htmlFor='ticket-queue-overdue'>{t('Overdue only')}</Label>
      </div>
      <div className='flex items-center gap-2'>
        <Switch
          id='ticket-queue-mine'
          checked={props.search.mine ?? false}
          onCheckedChange={(checked) =>
            changeFilters({ mine: checked || undefined })
          }
        />
        <Label htmlFor='ticket-queue-mine'>{t('Assigned to me')}</Label>
      </div>
      {props.search.user_id && (
        <Button
          variant='outline'
          onClick={() => changeFilters({ user_id: undefined })}
        >
          {t('User #{{id}}', { id: props.search.user_id })} ×
        </Button>
      )}
      <Button
        variant='outline'
        disabled={query.isFetching}
        onClick={() => void query.refetch()}
      >
        {t('Refresh')}
      </Button>
    </div>
  )

  return (
    <>
      <SectionPageLayout fixedContent>
        <SectionPageLayout.Title>
          {t('Ticket Management')}
        </SectionPageLayout.Title>
        {canManage && (
          <SectionPageLayout.Actions>
            <Button variant='outline' onClick={() => setDialog('canned')}>
              <MessageSquareText className='size-4' aria-hidden='true' />
              {t('Canned replies')}
            </Button>
            <Button variant='outline' onClick={() => setDialog('sla')}>
              <Timer className='size-4' aria-hidden='true' />
              {t('Response targets')}
            </Button>
          </SectionPageLayout.Actions>
        )}
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
              isLoading={query.isPending}
              isFetching={query.isFetching}
              emptyTitle={t('No tickets found')}
              mobileProps={{ enableRowSelection: false }}
            />
          )}
        </SectionPageLayout.Content>
      </SectionPageLayout>
      <TicketSlaDialog
        open={dialog === 'sla'}
        onOpenChange={(open) => setDialog(open ? 'sla' : null)}
      />
      <CannedRepliesDialog
        open={dialog === 'canned'}
        onOpenChange={(open) => setDialog(open ? 'canned' : null)}
      />
    </>
  )
}
