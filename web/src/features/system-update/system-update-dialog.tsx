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
import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'

import { Dialog } from '@/components/dialog'
import { Button } from '@/components/ui/button'

import { OnlineUpgradeCard } from './components/online-upgrade-card'
import type { useUpdateNotice } from './online-upgrade'

type SystemUpdateDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  trigger: ReactElement
  notice: ReturnType<typeof useUpdateNotice>
}

/** The server's release check, with per-administrator ignore controls. */
export function SystemUpdateDialog(props: SystemUpdateDialogProps) {
  const { t } = useTranslation()
  const { latest, isIgnored, setIgnored } = props.notice

  return (
    <Dialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      trigger={props.trigger}
      title={t('System updates')}
      bodyClassName='space-y-4'
      footerClassName='sm:flex-wrap'
      footer={
        latest ? (
          <>
            <Button
              type='button'
              variant='ghost'
              className='sm:me-auto'
              onClick={() => setIgnored(!isIgnored)}
            >
              {isIgnored ? t('Restore notifications') : t('Ignore this version')}
            </Button>
            {latest.url && (
              <Button
                nativeButton={false}
                role='link'
                render={
                  <a
                    href={latest.url}
                    target='_blank'
                    rel='noopener noreferrer'
                  />
                }
              >
                {t('Go to GitHub')}
              </Button>
            )}
          </>
        ) : undefined
      }
    >
      {isIgnored && (
        <p role='status' aria-live='polite' className='text-sm'>
          {t('This version is ignored')}
        </p>
      )}
      {props.open && <OnlineUpgradeCard />}
    </Dialog>
  )
}
