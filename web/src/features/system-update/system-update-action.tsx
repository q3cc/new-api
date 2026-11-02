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
import {
  ArrowUp01Icon,
  InformationCircleIcon,
  RefreshIcon,
} from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { ROLE } from '@/lib/roles'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth-store'

import { OnlineUpgradeCard } from './components/online-upgrade-card'
import { useOnlineUpgradeStatus } from './online-upgrade'
import { SystemUpdateDialog } from './system-update-dialog'
import { useSystemUpdate } from './use-system-update'

type SystemUpdateActionProps = {
  /** Version labels expand when the header's system-brand container has room. */
  presentation?: 'action' | 'version'
  compact?: boolean
}

export function SystemUpdateAction(props: SystemUpdateActionProps) {
  const isAdmin = useAuthStore(
    (state) => (state.auth.user?.role ?? 0) >= ROLE.ADMIN
  )
  if (!isAdmin) return null
  return <AdminSystemUpdateAction {...props} />
}

function AdminSystemUpdateAction(props: SystemUpdateActionProps) {
  const { t } = useTranslation()
  const update = useSystemUpdate()
  const isRoot = useAuthStore(
    (state) => (state.auth.user?.role ?? 0) >= ROLE.SUPER_ADMIN
  )
  // Super administrators also see this server's own releases, which they
  // can install online.
  const online = useOnlineUpgradeStatus()
  const onlineVersion = online.data?.check?.has_update
    ? online.data.check.latest?.version
    : undefined
  const notify = update.shouldNotify || Boolean(onlineVersion)
  const [open, setOpen] = useState(false)
  const compact = props.compact ?? true
  const versionPresentation = props.presentation === 'version'
  const version = update.currentVersion?.trim() || t('Unknown version')
  const label = notify ? t('Update available') : t('Check for updates')
  let description = label
  if (notify) {
    description = t('New version available: {{version}}', {
      version: onlineVersion ?? update.release?.tag_name,
    })
  } else if (update.snapshot?.error) {
    description = t('Failed to check for updates')
  }
  const updateAnnouncement = notify ? description : ''
  if (versionPresentation) {
    const versionDescription = t(
      'System updates, current version: {{version}}',
      { version }
    )
    description =
      notify || update.snapshot?.error
        ? `${versionDescription}\n${description}`
        : versionDescription
  }

  let triggerContent = (
    <>
      {update.checking ? (
        <Spinner data-icon='inline-start' aria-hidden='true' />
      ) : (
        <HugeiconsIcon
          icon={notify ? ArrowUp01Icon : RefreshIcon}
          data-icon='inline-start'
          aria-hidden='true'
        />
      )}
      <span className={cn(compact && 'hidden lg:inline')}>{label}</span>
    </>
  )
  if (versionPresentation) {
    triggerContent = (
      <>
        <HugeiconsIcon
          icon={notify ? ArrowUp01Icon : InformationCircleIcon}
          className={cn(
            '@min-[22rem]/system-brand:hidden',
            notify && 'text-primary'
          )}
          aria-hidden='true'
        />
        <span className='hidden max-w-32 truncate font-mono text-xs @min-[22rem]/system-brand:inline'>
          {version}
        </span>
        {notify && (
          <Badge
            variant='secondary'
            className='bg-primary/10 text-primary hidden h-5 px-1.5 text-[10px] @min-[22rem]/system-brand:inline-flex'
          >
            {t('Update available')}
          </Badge>
        )}
      </>
    )
  }

  return (
    <SystemUpdateDialog
      open={open}
      onOpenChange={setOpen}
      update={update}
      onlineUpgrade={isRoot ? <OnlineUpgradeCard /> : null}
      trigger={
        <Button
          type='button'
          variant={!versionPresentation && notify ? 'outline' : 'ghost'}
          aria-label={description}
          title={description}
          aria-busy={update.checking}
          className={cn(
            'relative',
            versionPresentation &&
              'text-muted-foreground size-8 px-0 @min-[22rem]/system-brand:h-7 @min-[22rem]/system-brand:w-auto @min-[22rem]/system-brand:gap-1.5 @min-[22rem]/system-brand:px-1.5',
            !versionPresentation &&
              compact &&
              'size-8 px-0 lg:w-auto lg:gap-1.5 lg:px-2.5',
            !versionPresentation &&
              notify &&
              'border-primary/40 bg-primary/10 text-primary'
          )}
        >
          {triggerContent}
          {notify && (versionPresentation || compact) && (
            <Badge
              aria-hidden='true'
              className={cn(
                'absolute -end-0.5 -top-0.5 size-1.5 min-w-0 p-0',
                versionPresentation
                  ? '@min-[22rem]/system-brand:hidden'
                  : 'lg:hidden'
              )}
            />
          )}
          <span className='sr-only' role='status' aria-live='polite'>
            {updateAnnouncement}
          </span>
        </Button>
      }
    />
  )
}
