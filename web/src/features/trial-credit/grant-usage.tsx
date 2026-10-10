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

import { Progress } from '@/components/ui/progress'
import { toIntlLocale } from '@/i18n/languages'
import { formatQuota, formatDateTimeStr, formatNumber } from '@/lib/format'

import type { TrialGrant } from './api'

export function TrialGrantUsage(props: { grant: TrialGrant }) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const total = Math.max(0, props.grant.quota)
  const unspent = Math.min(total, Math.max(0, props.grant.remaining))
  const used = total - unspent
  const usagePercent = total > 0 ? (used / total) * 100 : 0
  const expired =
    props.grant.expires_at > 0 && props.grant.expires_at * 1000 <= Date.now()
  const remaining = expired ? 0 : unspent
  const percentLabel = `${formatNumber(usagePercent, locale)}%`
  const name = t(props.grant.type_name || 'Trial credit')
  const progressName = [name, props.grant.group, t('Usage')]
    .filter(Boolean)
    .join(' · ')
  return (
    <div className='min-w-0 space-y-2 rounded-lg border p-3 text-sm'>
      <div className='flex flex-wrap items-start justify-between gap-x-3 gap-y-1'>
        <span className='min-w-0 font-medium [overflow-wrap:anywhere]'>
          {props.grant.type_id} · {name} · {props.grant.group}
        </span>
        <span className='text-muted-foreground'>
          {expired ? t('Expired') : null}
          {expired && ' · '}
          {props.grant.expires_at
            ? formatDateTimeStr(new Date(props.grant.expires_at * 1000))
            : t('Never expires')}
        </span>
      </div>
      <div className='flex flex-wrap justify-between gap-x-3 gap-y-1 tabular-nums'>
        <span>
          {t('Remaining')}: {formatQuota(remaining)} / {formatQuota(total)}
        </span>
        <span className='text-muted-foreground'>
          {t('Used')}: {percentLabel}
        </span>
      </div>
      <Progress
        value={usagePercent}
        aria-label={progressName}
        aria-valuetext={`${t('Used')}: ${formatQuota(used)} / ${formatQuota(total)} (${percentLabel})`}
        className='w-full [&_[data-slot=progress-track]]:h-1.5'
      />
    </div>
  )
}
