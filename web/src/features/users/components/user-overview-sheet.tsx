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

import {
  sideDrawerContentClassName,
  sideDrawerFooterClassName,
  sideDrawerFormClassName,
  sideDrawerHeaderClassName,
} from '@/components/drawer-layout'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'

import { UserOverview } from './user-overview'
import { useUsers } from './users-provider'

/** The overview of the user picked in the users table, read-only. */
export function UserOverviewSheet() {
  const { t } = useTranslation()
  const { open, setOpen, currentRow, triggerRefresh } = useUsers()
  const user = open === 'overview' ? currentRow : null

  return (
    <Sheet
      open={user !== null}
      onOpenChange={(next) => {
        if (!next) setOpen(null)
      }}
    >
      <SheetContent className={sideDrawerContentClassName('sm:max-w-[440px]')}>
        <SheetHeader className={sideDrawerHeaderClassName()}>
          <SheetTitle>{t('User overview')}</SheetTitle>
          <SheetDescription>
            {user ? `${user.username} · #${user.id}` : ''}
          </SheetDescription>
        </SheetHeader>
        <div className={sideDrawerFormClassName()}>
          {user && (
            <UserOverview
              key={user.id}
              userId={user.id}
              showUsersLink={false}
              onChanged={triggerRefresh}
            />
          )}
        </div>
        <SheetFooter className={sideDrawerFooterClassName()}>
          <SheetClose render={<Button variant='outline' />}>
            {t('Close')}
          </SheetClose>
          <Button onClick={() => setOpen('update')}>{t('Edit')}</Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
