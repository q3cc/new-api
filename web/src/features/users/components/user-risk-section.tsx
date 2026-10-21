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
import { useTranslation } from 'react-i18next'

import { TimestampCell } from '@/components/activity-time-cell'
import { SideDrawerSection } from '@/components/drawer-layout'
import { requireServerSuccess } from '@/lib/server-error-message'

import { getUserRiskDetail } from '../api'
import type { UserRiskRelation } from '../types'
import { UserRiskBadge } from './user-risk-badge'

type UserRiskSectionProps = {
  userId: number
}

type RiskRelationListProps = {
  title: string
  relations: UserRiskRelation[]
}

function RiskRelationList(props: RiskRelationListProps) {
  const { t } = useTranslation()
  if (props.relations.length === 0) return null

  return (
    <div className='flex flex-col gap-1'>
      <h4 className='text-muted-foreground text-xs'>{props.title}</h4>
      <ul className='divide-y rounded-md border' aria-label={props.title}>
        {props.relations.map((relation) => (
          <li
            key={relation.user_id}
            className='flex flex-col gap-0.5 px-3 py-1.5 text-sm'
          >
            <span className='truncate'>
              {relation.username || t('Deleted user')}
              <span className='text-muted-foreground ml-1 text-xs'>
                #{relation.user_id}
              </span>
            </span>
            <span className='text-muted-foreground font-mono text-xs break-all'>
              {relation.matches.join(', ')}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

export function UserRiskSection(props: UserRiskSectionProps) {
  const { t } = useTranslation()
  const { data, isPending } = useQuery({
    queryKey: ['user-risk', props.userId],
    queryFn: async () =>
      requireServerSuccess(await getUserRiskDetail(props.userId)).data,
  })

  const score = data?.score
  const sharedIp = data?.details.shared_ip ?? []
  const sameSubnet = data?.details.same_subnet ?? []

  return (
    <SideDrawerSection>
      <div className='flex items-center gap-2'>
        <h3 className='text-sm font-medium'>{t('Risk Score')}</h3>
        {score && <UserRiskBadge risk={score} />}
      </div>
      <p className='text-muted-foreground text-xs'>
        {t(
          'Recalculated hourly from recent IPs: accounts sharing an exact IP, accounts in the same IP range (IPv4 /24, IPv6 /64), and the number of distinct IPs used.'
        )}
      </p>
      {isPending && (
        <p className='text-muted-foreground text-sm'>{t('Loading...')}</p>
      )}
      {score && (
        <dl className='grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm'>
          <dt className='text-muted-foreground'>
            {t('Accounts sharing an IP')}
          </dt>
          <dd className='tabular-nums'>{score.shared_ip_users}</dd>
          <dt className='text-muted-foreground'>
            {t('Accounts in the same IP range')}
          </dt>
          <dd className='tabular-nums'>{score.same_subnet_users}</dd>
          <dt className='text-muted-foreground'>{t('Distinct IPs')}</dt>
          <dd className='tabular-nums'>{score.ip_count}</dd>
          <dt className='text-muted-foreground'>{t('Last calculated')}</dt>
          <dd>
            <TimestampCell
              timestamp={score.updated_at}
              format='absolute'
              justNowLabel={t('Just now')}
            />
          </dd>
        </dl>
      )}
      <RiskRelationList
        title={t('Accounts sharing an IP')}
        relations={sharedIp}
      />
      <RiskRelationList
        title={t('Accounts in the same IP range')}
        relations={sameSubnet}
      />
    </SideDrawerSection>
  )
}
