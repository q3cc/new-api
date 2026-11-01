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
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'

type PagePagerProps = {
  page: number
  pageCount: number
  onPageChange: (page: number) => void
}

/**
 * Previous and next page buttons for a server-paged list shown in a static
 * table, which has no TanStack table state for `DataTablePagination`. It
 * renders nothing when everything fits on one page.
 */
export function PagePager(props: PagePagerProps) {
  const { t } = useTranslation()
  if (props.pageCount <= 1) return null
  return (
    <div className='flex items-center justify-end gap-2 text-sm'>
      <Button
        size='sm'
        variant='outline'
        onClick={() => props.onPageChange(props.page - 1)}
        disabled={props.page <= 1}
      >
        {t('Previous page')}
      </Button>
      <span className='text-muted-foreground tabular-nums'>
        {props.page} / {props.pageCount}
      </span>
      <Button
        size='sm'
        variant='outline'
        onClick={() => props.onPageChange(props.page + 1)}
        disabled={props.page >= props.pageCount}
      >
        {t('Next page')}
      </Button>
    </div>
  )
}
