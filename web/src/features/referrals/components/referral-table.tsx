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
import type { UseQueryResult } from '@tanstack/react-query'
import type {
  ColumnDef,
  OnChangeFn,
  PaginationState,
} from '@tanstack/react-table'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { DataTablePage, useDataTable } from '@/components/data-table'
import { ErrorState } from '@/components/error-state'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { NavigateFn } from '@/hooks/use-table-url-state'
import { getServerErrorMessage } from '@/lib/server-error-message'

import type { ReferralsSearch } from '../api'
import { changeReferralFilters } from '../lib/referral-filters'
import type { ReferralPage } from '../types'

export function ReferralUserCell(props: { id: number; username?: string }) {
  return (
    <div className='min-w-0'>
      <span className='tabular-nums'>#{props.id}</span>
      <div className='text-muted-foreground max-w-40 truncate text-xs'>
        {props.username || '—'}
      </div>
    </div>
  )
}

type ReferralToolbarProps = {
  search: ReferralsSearch
  navigate: NavigateFn
  pageSize: number
  refreshing: boolean
  onRefresh: () => void
  children?: ReactNode
}

/** User ID filter, the tab's own filters, reset and refresh. */
export function ReferralToolbar(props: ReferralToolbarProps) {
  const { t } = useTranslation()
  return (
    <div className='flex flex-wrap gap-2'>
      <Input
        aria-label={t('User ID')}
        placeholder={t('User ID')}
        inputMode='numeric'
        value={props.search.user_id ? String(props.search.user_id) : ''}
        onChange={(event) => {
          const digits = event.target.value.replaceAll(/\D/g, '').slice(0, 10)
          changeReferralFilters(props.navigate, {
            user_id: digits ? Number(digits) : undefined,
          })
        }}
        className='w-full sm:w-36'
      />
      {props.children}
      <Button
        variant='outline'
        onClick={() =>
          props.navigate({
            search: {
              tab: props.search.tab,
              page: 1,
              pageSize: props.pageSize,
            },
            replace: true,
          })
        }
      >
        {t('Reset')}
      </Button>
      <Button
        variant='outline'
        disabled={props.refreshing}
        onClick={props.onRefresh}
      >
        {t('Refresh')}
      </Button>
    </div>
  )
}

type ReferralTableProps<T> = {
  query: UseQueryResult<ReferralPage<T>>
  columns: ColumnDef<T, unknown>[]
  toolbar: ReactNode
  emptyTitle: string
  getRowId: (row: T) => string
  pagination: PaginationState
  onPaginationChange: OnChangeFn<PaginationState>
  ensurePageInRange: (pageCount: number) => void
}

/** A server-paged referral list that keeps its toolbar when loading fails. */
export function ReferralTable<T>(props: ReferralTableProps<T>) {
  const { table } = useDataTable({
    data: props.query.data?.items ?? [],
    columns: props.columns,
    pagination: props.pagination,
    onPaginationChange: props.onPaginationChange,
    ensurePageInRange: props.ensurePageInRange,
    totalCount: props.query.data?.total ?? 0,
    manualFiltering: true,
    manualPagination: true,
    manualSorting: true,
    enableSorting: false,
    enableRowSelection: false,
    getRowId: props.getRowId,
  })
  if (props.query.isError) {
    return (
      <div className='space-y-4'>
        {props.toolbar}
        <ErrorState
          description={getServerErrorMessage(props.query.error)}
          onRetry={() => void props.query.refetch()}
        />
      </div>
    )
  }
  return (
    <DataTablePage
      table={table}
      columns={props.columns}
      toolbar={props.toolbar}
      isLoading={props.query.isPending}
      isFetching={props.query.isFetching}
      emptyTitle={props.emptyTitle}
      mobileProps={{ enableRowSelection: false }}
    />
  )
}
