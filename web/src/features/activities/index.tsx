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

import { SectionPageLayout } from '@/components/layout'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ROLE } from '@/lib/roles'
import { useAuthStore } from '@/stores/auth-store'

import { ActivitiesList } from './components/activities-list'
import { ActivitiesAdmin } from './components/admin/activities-admin'
import { MyPrizes } from './components/my-prizes'

export type ActivitiesTab = 'activities' | 'prizes' | 'manage'

type ActivitiesProps = {
  tab: ActivitiesTab
  onTabChange: (tab: ActivitiesTab) => void
}

export function Activities(props: ActivitiesProps) {
  const { t } = useTranslation()
  const isAdmin = useAuthStore(
    (state) => (state.auth.user?.role ?? 0) >= ROLE.ADMIN
  )
  const tab = props.tab === 'manage' && !isAdmin ? 'activities' : props.tab

  let content = <ActivitiesList />
  if (tab === 'prizes') content = <MyPrizes />
  if (tab === 'manage') content = <ActivitiesAdmin />

  return (
    <SectionPageLayout>
      <SectionPageLayout.Title>{t('Activities')}</SectionPageLayout.Title>
      <SectionPageLayout.Content>
        <div className='flex flex-col gap-4'>
          <Tabs
            value={tab}
            onValueChange={(value) => props.onTabChange(value as ActivitiesTab)}
          >
            <TabsList>
              <TabsTrigger value='activities'>{t('Activities')}</TabsTrigger>
              <TabsTrigger value='prizes'>{t('My prizes')}</TabsTrigger>
              {isAdmin ? (
                <TabsTrigger value='manage'>{t('Manage')}</TabsTrigger>
              ) : null}
            </TabsList>
          </Tabs>
          {content}
        </div>
      </SectionPageLayout.Content>
    </SectionPageLayout>
  )
}
