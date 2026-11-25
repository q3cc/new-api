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
import { ChevronDown } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { UserOverview } from '@/features/users/components/user-overview'
import { useMediaQuery } from '@/hooks/use-media-query'

/**
 * The ticket owner's overview beside the conversation. On narrow screens it
 * starts folded so the conversation stays near the top, and loads only
 * once opened.
 */
export function TicketOwnerCard(props: { userId: number; username?: string }) {
  const { t } = useTranslation()
  const wide = useMediaQuery('(min-width: 1024px)')

  if (wide) {
    return (
      <section
        aria-label={t('User info')}
        className='space-y-3 rounded-lg border p-4'
      >
        <h3 className='text-sm font-medium'>{t('User info')}</h3>
        <UserOverview userId={props.userId} />
      </section>
    )
  }
  return (
    <Collapsible className='rounded-lg border'>
      <CollapsibleTrigger className='group flex w-full cursor-pointer items-center justify-between gap-2 px-4 py-3 text-left text-sm font-medium'>
        <span className='min-w-0 truncate'>
          {t('User info')}
          {props.username && (
            <span className='text-muted-foreground font-normal'>
              {' · '}
              {props.username}
            </span>
          )}
        </span>
        <ChevronDown
          className='size-4 shrink-0 transition-transform group-data-[panel-open]:rotate-180'
          aria-hidden='true'
        />
      </CollapsibleTrigger>
      <CollapsibleContent className='px-4 pb-4'>
        <UserOverview userId={props.userId} />
      </CollapsibleContent>
    </Collapsible>
  )
}
