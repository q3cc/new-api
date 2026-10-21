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
import { CopyButton } from '@/components/copy-button'
import { SideDrawerSection } from '@/components/drawer-layout'
import { requireServerSuccess } from '@/lib/server-error-message'

import { getUserRecentIps } from '../api'

type UserRecentIpsSectionProps = {
  userId: number
}

export function UserRecentIpsSection(props: UserRecentIpsSectionProps) {
  const { t } = useTranslation()
  const { data: ips = [], isPending } = useQuery({
    queryKey: ['user-recent-ips', props.userId],
    queryFn: async () =>
      requireServerSuccess(await getUserRecentIps(props.userId)).data ?? [],
  })

  let content
  if (isPending) {
    content = <p className='text-muted-foreground text-sm'>{t('Loading...')}</p>
  } else if (ips.length === 0) {
    content = (
      <p className='text-muted-foreground text-sm'>{t('No IP records')}</p>
    )
  } else {
    content = (
      <ul className='divide-y rounded-md border' aria-label={t('Recent IPs')}>
        {ips.map((item) => (
          <li
            key={item.ip}
            className='flex items-center gap-3 px-3 py-1.5 text-sm'
          >
            <span className='min-w-0 flex-1 truncate font-mono'>{item.ip}</span>
            <TimestampCell
              timestamp={item.last_seen}
              format='absolute'
              justNowLabel={t('Just now')}
              className='text-muted-foreground text-xs'
            />
            <CopyButton value={item.ip} className='size-7' />
          </li>
        ))}
      </ul>
    )
  }

  return (
    <SideDrawerSection>
      <h3 className='text-sm font-medium'>{t('Recent IPs')}</h3>
      <p className='text-muted-foreground text-xs'>
        {t(
          'Last 5 distinct IPs from sign-ins, account activity and API requests (read-only). API request IPs are only recorded when the user enables IP logging.'
        )}
      </p>
      {content}
    </SideDrawerSection>
  )
}
