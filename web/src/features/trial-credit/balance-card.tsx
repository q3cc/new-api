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
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ErrorState } from '@/components/error-state'
import { LoadingState } from '@/components/loading-state'
import { Button } from '@/components/ui/button'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { formatQuota, formatDateTimeStr } from '@/lib/format'

import { getTrialBalance } from './api'

export function TrialBalanceCard() {
  const { t } = useTranslation()
  const [page, setPage] = useState(1)
  const query = useQuery({
    queryKey: ['trial-balance', page],
    queryFn: () => getTrialBalance(page),
    refetchInterval: 30000,
  })
  if (query.isPending) return <LoadingState />
  if (query.isError) return <ErrorState onRetry={() => void query.refetch()} />
  const data = query.data
  if (!data.enabled && !data.total) return null
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {t('Trial credit')} · {formatQuota(data.balance)}
        </CardTitle>
      </CardHeader>
      <CardContent className='space-y-3'>
        <div className='text-sm'>
          {t('Trial group')}: {data.group}
        </div>
        {data.grants.map((grant) => (
          <div
            key={grant.id}
            className='flex flex-wrap justify-between gap-2 text-sm'
          >
            <span>
              {formatQuota(
                grant.expires_at > 0 && grant.expires_at * 1000 <= Date.now()
                  ? 0
                  : grant.remaining
              )}{' '}
              / {formatQuota(grant.quota)}
            </span>
            <span>
              {grant.expires_at
                ? formatDateTimeStr(new Date(grant.expires_at * 1000))
                : t('Never expires')}
            </span>
          </div>
        ))}
        {data.grants.length === 0 && <div>{t('No records')}</div>}
        {data.records.map((record) => (
          <div
            key={record.id}
            className='flex flex-wrap gap-3 border-t pt-2 text-sm'
          >
            <span>
              {t('Trial credit')}: {formatQuota(record.trial_charged)}
            </span>
            <span>
              {t('Wallet')}: {formatQuota(record.wallet_charged)}
            </span>
            <span>
              {t('Waived')}: {formatQuota(record.waived)}
            </span>
          </div>
        ))}
        <div className='flex gap-2'>
          <Button
            variant='outline'
            disabled={page === 1}
            onClick={() => setPage((p) => p - 1)}
          >
            {t('Previous')}
          </Button>
          <Button
            variant='outline'
            disabled={
              page * 10 >= Math.max(data.total, data.records_total ?? 0)
            }
            onClick={() => setPage((p) => p + 1)}
          >
            {t('Next')}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
