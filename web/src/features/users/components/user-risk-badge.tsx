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

import { Badge } from '@/components/ui/badge'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

import { userRiskBadgeClassName } from '../lib/user-risk'
import type { UserRiskScore } from '../types'

type UserRiskBadgeProps = {
  risk?: UserRiskScore
}

export function UserRiskBadge(props: UserRiskBadgeProps) {
  const { t } = useTranslation()
  const score = props.risk?.score ?? 0

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Badge
            variant='outline'
            tabIndex={0}
            aria-label={t('Risk score {{score}}', { score })}
            className={cn(
              'h-5 min-w-5 rounded-full px-1.5 py-0 text-sm leading-none font-medium shadow-none tabular-nums',
              userRiskBadgeClassName(score)
            )}
          />
        }
      >
        {score}
      </TooltipTrigger>
      <TooltipContent>
        <div className='flex flex-col gap-0.5 text-xs'>
          <span>{t('Risk score {{score}}', { score })}</span>
          <span>
            {t('Accounts sharing an IP: {{count}}', {
              count: props.risk?.shared_ip_users ?? 0,
            })}
          </span>
          <span>
            {t('Accounts in the same IP range: {{count}}', {
              count: props.risk?.same_subnet_users ?? 0,
            })}
          </span>
          <span>
            {t('Distinct IPs: {{count}}', {
              count: props.risk?.ip_count ?? 0,
            })}
          </span>
        </div>
      </TooltipContent>
    </Tooltip>
  )
}
