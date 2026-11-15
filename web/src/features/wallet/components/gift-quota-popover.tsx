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
import { CircleHelp, Gift } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { QuotaDetailsPopover } from '@/components/quota-details-popover'
import { formatQuota } from '@/lib/format'
import { cn } from '@/lib/utils'

import type { GiftQuotaSource, GiftQuotaSummary } from '../types'

interface GiftQuotaPopoverProps {
  summary: GiftQuotaSummary
  className?: string
}

/**
 * Shows the cumulative gift credit; opening it lists where the credit came
 * from and how gift credit is treated.
 */
export function GiftQuotaPopover(props: GiftQuotaPopoverProps) {
  const { t } = useTranslation()
  const sourceLabels: Record<GiftQuotaSource, string> = {
    registration: t('Sign-up bonus'),
    affiliate: t('Invitation rewards'),
    lottery: t('Lottery prizes'),
    checkin: t('Check-in rewards'),
    redemption: t('Gift redemption codes'),
    admin: t('Platform gifts'),
  }
  const total = formatQuota(props.summary.total)
  const label = t('Gift credit received: {{amount}}', { amount: total })

  return (
    <QuotaDetailsPopover
      title={t('About gift credit')}
      triggerLabel={label}
      details={[
        ...props.summary.items.map((item) => ({
          label: sourceLabels[item.source] ?? item.source,
          value: formatQuota(item.quota),
        })),
        { label: t('Total gift credit received'), value: total },
      ]}
      description={t(
        'Gift credit comes from sign-up bonuses, invitation rewards, lottery prizes, check-ins and other platform giveaways. It is spent together with your balance. It can only be used on this platform and cannot be withdrawn or transferred. When you request a refund, the gift credit you have received is deducted first; see the user agreement for details.'
      )}
      className={cn('w-auto', props.className)}
      triggerClassName='w-auto max-w-full'
    >
      <span className='inline-flex max-w-full min-w-0 items-center gap-1 rounded-md border border-amber-500/30 bg-amber-500/10 px-1 py-0.5 text-[11px] font-medium whitespace-normal text-amber-700 sm:px-1.5 sm:text-xs dark:text-amber-400'>
        <Gift className='size-3 shrink-0 sm:size-3.5' aria-hidden='true' />
        {/* Phone columns are too narrow for the full label. */}
        <span className='min-w-0 break-all sm:hidden'>
          {t('Gift {{amount}}', { amount: total })}
        </span>
        <span className='hidden min-w-0 truncate sm:inline'>{label}</span>
        <CircleHelp
          className='hidden size-3.5 shrink-0 opacity-70 sm:block'
          aria-hidden='true'
        />
      </span>
    </QuotaDetailsPopover>
  )
}
