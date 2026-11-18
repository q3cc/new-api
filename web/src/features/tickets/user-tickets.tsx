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
import { Plus } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { DataTablePage, useDataTable } from '@/components/data-table'
import { ErrorState } from '@/components/error-state'
import { SectionPageLayout } from '@/components/layout'
import { Button } from '@/components/ui/button'
import { Combobox } from '@/components/ui/combobox'
import { useTableUrlState, type NavigateFn } from '@/hooks/use-table-url-state'
import { formatTimestampToDate } from '@/lib/format'
import { getServerErrorMessage } from '@/lib/server-error-message'

import {
  getUserTickets,
  ticketKeys,
  userTicketsSearchSchema,
  type UserTicketsSearch,
} from './api'
import { CreateTicketDialog } from './components/create-ticket-dialog'
import { TicketStatusBadge } from './components/ticket-status-badge'
import { TicketTitleLink } from './components/ticket-title-link'
import {
  TICKET_CATEGORY_LABEL_KEYS,
  TICKET_STATUS_CONFIG,
  TICKET_STATUSES,
} from './constants'
import type { Ticket } from './types'

export function UserTicketsPage(props: {
  search: UserTicketsSearch
  navigate: NavigateFn
}) {
  const { t } = useTranslation()
  const [creating, setCreating] = useState(false)
  const { pagination, onPaginationChange, ensurePageInRange } =
    useTableUrlState({
      search: props.search,
      navigate: props.navigate,
      globalFilter: { enabled: false },
      pagination: { defaultPageSize: 20 },
    })
  const search = {
    status: props.search.status,
    page: pagination.pageIndex + 1,
    pageSize: pagination.pageSize,
  }
  const query = useQuery({
    queryKey: ticketKeys.userList(search),
    queryFn: ({ signal }) => getUserTickets(search, signal),
    meta: { errorToast: false },
  })
  const columns: ColumnDef<Ticket, unknown>[] = [
    {
      accessorKey: 'title',
      header: t('Ticket'),
      cell: ({ row }) => (
        <TicketTitleLink ticket={row.original} viewer='user' />
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
      accessorKey: 'updated_at',
      header: t('Last activity'),
      cell: ({ row }) => formatTimestampToDate(row.original.updated_at),
    },
  ]
  const { table } = useDataTable({
    data: query.data?.page.items ?? [],
    columns,
    pagination,
    onPaginationChange,
    ensurePageInRange,
    totalCount: query.data?.page.total ?? 0,
    manualFiltering: true,
    manualPagination: true,
    manualSorting: true,
    enableSorting: false,
    enableRowSelection: false,
    getRowId: (row) => String(row.id),
  })
  const toolbar = (
    <div className='flex flex-wrap gap-2'>
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
          props.navigate({
            search: (prev) =>
              userTicketsSearchSchema.parse({
                ...prev,
                status: value || undefined,
                page: 1,
              }),
            replace: true,
          })
        }
      />
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
        <SectionPageLayout.Title>{t('My Tickets')}</SectionPageLayout.Title>
        <SectionPageLayout.Actions>
          <Button onClick={() => setCreating(true)}>
            <Plus className='size-4' aria-hidden='true' />
            {t('New ticket')}
          </Button>
        </SectionPageLayout.Actions>
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
              emptyTitle={t('No tickets yet')}
              mobileProps={{ enableRowSelection: false }}
            />
          )}
        </SectionPageLayout.Content>
      </SectionPageLayout>
      <CreateTicketDialog open={creating} onOpenChange={setCreating} />
    </>
  )
}
