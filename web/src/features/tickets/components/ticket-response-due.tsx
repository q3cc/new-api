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

import { StatusBadge } from '@/components/status-badge'
import { toIntlLocale } from '@/i18n/languages'
import { formatTimestampToDate } from '@/lib/format'

import { formatSlaDuration, responseDue } from '../lib/sla'

/**
 * Time left before an open ticket misses its response target, or how long it
 * is past it. Tickets not waiting for support show a dash.
 */
export function TicketResponseDue(props: { dueAt?: number }) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  if (!props.dueAt) {
    return <span className='text-muted-foreground'>—</span>
  }
  const due = responseDue(props.dueAt, Math.floor(Date.now() / 1000))
  const duration = formatSlaDuration(due.seconds, locale)
  const deadline = formatTimestampToDate(props.dueAt)
  if (due.overdue) {
    return (
      <StatusBadge
        label={t('Overdue by {{duration}}', { duration })}
        variant='danger'
        copyable={false}
        title={deadline}
      />
    )
  }
  return (
    <span className='text-sm whitespace-nowrap' title={deadline}>
      {t('Due in {{duration}}', { duration })}
    </span>
  )
}
