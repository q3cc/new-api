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
import { Link } from '@tanstack/react-router'
import { useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'

import { TimestampCell } from '@/components/activity-time-cell'
import { Dialog } from '@/components/dialog'
import { StatusBadge } from '@/components/status-badge'
import { requireServerSuccess } from '@/lib/server-error-message'

import { getUserInvitees } from '../api'
import { USER_STATUSES } from '../constants'
import { UserRiskBadge } from './user-risk-badge'

type UserInviteesDialogProps = {
  userId: number
  username: string
  trigger: ReactElement
}

export function UserInviteesDialog(props: UserInviteesDialogProps) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const { data, isPending } = useQuery({
    queryKey: ['user-invitees', props.userId],
    queryFn: async () =>
      requireServerSuccess(await getUserInvitees(props.userId)).data,
    enabled: open,
  })
  const invitees = data?.items ?? []
  const total = data?.total ?? 0

  let content
  if (isPending) {
    content = <p className='text-muted-foreground text-sm'>{t('Loading...')}</p>
  } else if (invitees.length === 0) {
    content = (
      <p className='text-muted-foreground text-sm'>{t('No invited users')}</p>
    )
  } else {
    content = (
      <ul
        className='divide-y rounded-md border'
        aria-label={t('Invited users')}
      >
        {invitees.map((invitee) => {
          const status =
            USER_STATUSES[invitee.status as keyof typeof USER_STATUSES]
          return (
            <li
              key={invitee.id}
              className='grid grid-cols-[minmax(0,1fr)_4.5rem_9.5rem] items-center gap-3 px-3 py-2 text-sm'
            >
              <div className='min-w-0'>
                <div className='flex min-w-0 items-center gap-1.5'>
                  <Link
                    to='/users'
                    search={{ filter: invitee.username }}
                    onClick={() => setOpen(false)}
                    className='hover:text-primary truncate transition-colors'
                  >
                    {invitee.username}
                  </Link>
                  <span className='text-muted-foreground shrink-0 text-xs tabular-nums'>
                    #{invitee.id}
                  </span>
                  <UserRiskBadge risk={invitee.risk_score} />
                </div>
                {invitee.display_name &&
                  invitee.display_name !== invitee.username && (
                    <div className='text-muted-foreground truncate text-xs'>
                      {invitee.display_name}
                    </div>
                  )}
              </div>
              <div>
                {status && (
                  <StatusBadge
                    label={t(status.labelKey)}
                    variant={status.variant}
                    copyable={false}
                    className='font-normal'
                  />
                )}
              </div>
              <TimestampCell
                timestamp={invitee.created_at}
                format='absolute'
                justNowLabel={t('Just now')}
                className='text-muted-foreground text-xs tabular-nums'
              />
            </li>
          )
        })}
      </ul>
    )
  }

  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      trigger={props.trigger}
      title={t('Invited users')}
      description={t(
        'Accounts registered with the invite code of {{username}}',
        {
          username: props.username,
        }
      )}
      contentClassName='sm:max-w-xl'
      bodyClassName='space-y-2'
    >
      {content}
      {total > invitees.length && (
        <p className='text-muted-foreground text-xs'>
          {t('Showing the latest {{shown}} of {{total}} invited users', {
            shown: invitees.length,
            total,
          })}
        </p>
      )}
    </Dialog>
  )
}
