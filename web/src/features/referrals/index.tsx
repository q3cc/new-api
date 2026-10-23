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
import { getRouteApi } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'

import { SectionPageLayout } from '@/components/layout'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import type { NavigateFn } from '@/hooks/use-table-url-state'

import type { ReferralsSearch } from './api'
import { InviteLogsTab } from './components/invite-logs-tab'
import { InvitesTab } from './components/invites-tab'
import { RebatesTab } from './components/rebates-tab'
import { ReferralSummary } from './components/referral-summary'
import type { ReferralsTab } from './types'

const route = getRouteApi('/_authenticated/referrals/')
export function Referrals() {
  return (
    <ReferralsPage search={route.useSearch()} navigate={route.useNavigate()} />
  )
}

export function ReferralsPage(props: {
  search: ReferralsSearch
  navigate: NavigateFn
}) {
  const { t } = useTranslation()
  const tab: ReferralsTab = props.search.tab ?? 'invites'
  let content = <InvitesTab search={props.search} navigate={props.navigate} />
  if (tab === 'rebates') {
    content = <RebatesTab search={props.search} navigate={props.navigate} />
  }
  if (tab === 'logs') {
    content = <InviteLogsTab search={props.search} navigate={props.navigate} />
  }
  return (
    <SectionPageLayout fixedContent>
      <SectionPageLayout.Title>{t('Referrals')}</SectionPageLayout.Title>
      <SectionPageLayout.Content>
        <div className='flex h-full min-h-0 flex-col gap-4'>
          <div className='shrink-0'>
            <ReferralSummary />
          </div>
          <Tabs
            className='shrink-0'
            value={tab}
            onValueChange={(value) =>
              props.navigate({
                // Filters and paging belong to one tab, so switching starts clean.
                search: {
                  tab: value === 'invites' ? undefined : value,
                  page: 1,
                  pageSize: props.search.pageSize,
                },
              })
            }
          >
            <TabsList>
              <TabsTrigger value='invites'>{t('Invitations')}</TabsTrigger>
              <TabsTrigger value='rebates'>{t('Rebates')}</TabsTrigger>
              <TabsTrigger value='logs'>{t('Invitation logs')}</TabsTrigger>
            </TabsList>
          </Tabs>
          <div className='min-h-0 flex-1'>{content}</div>
        </div>
      </SectionPageLayout.Content>
    </SectionPageLayout>
  )
}
