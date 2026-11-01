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

import { CopyButton } from '@/components/copy-button'
import { SectionPageLayout } from '@/components/layout'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { AffiliateRebatesTable } from '@/features/wallet/components/affiliate-rebates-table'
import {
  useAffiliate,
  useAffiliateRebates,
} from '@/features/wallet/hooks/use-affiliate'
import { toIntlLocale } from '@/i18n/languages'
import { formatNumber } from '@/lib/format'

import { PromotionInvitees } from './components/promotion-invitees'
import { PromotionLeaderboard } from './components/promotion-leaderboard'
import type { PromotionTab } from './types'

type PromotionProps = {
  tab: PromotionTab
  onTabChange: (tab: PromotionTab) => void
}

/**
 * The promotion center every user can open: their referral link, the
 * leaderboard of referral earnings, the users they invited and the rebate
 * earned from each paid order.
 */
export function Promotion(props: PromotionProps) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const { affiliateLink } = useAffiliate()
  const { data: rebates } = useAffiliateRebates()

  let rule = t('Referral rebates are not enabled.')
  if (rebates?.enabled) {
    rule = t(
      'You earn {{rate}}% of every payment made by users you invite, credited after {{days}} days.',
      {
        rate: formatNumber(rebates.rate_percent, locale),
        days: rebates.confirm_days,
      }
    )
  }

  return (
    <SectionPageLayout>
      <SectionPageLayout.Title>{t('Promotion Center')}</SectionPageLayout.Title>
      <SectionPageLayout.Content>
        <div className='flex flex-col gap-4'>
          <Card data-card-hover='false' className='py-0'>
            <CardContent className='grid gap-2 p-3 sm:p-4'>
              <label
                htmlFor='promotion-referral-link'
                className='text-sm font-semibold'
              >
                {t('Your referral link')}
              </label>
              <div className='flex items-center gap-2'>
                <Input
                  id='promotion-referral-link'
                  value={affiliateLink}
                  readOnly
                  className='h-9 min-w-0 flex-1 font-mono text-xs'
                />
                <CopyButton
                  value={affiliateLink}
                  variant='outline'
                  className='size-9 shrink-0'
                  iconClassName='size-4'
                  tooltip={t('Copy referral link')}
                  aria-label={t('Copy referral link')}
                />
              </div>
              <p className='text-muted-foreground text-xs'>{rule}</p>
            </CardContent>
          </Card>
          <PromotionLeaderboard />
          <Tabs
            value={props.tab}
            onValueChange={(value) => props.onTabChange(value as PromotionTab)}
          >
            <TabsList>
              <TabsTrigger value='invitees'>{t('My invitees')}</TabsTrigger>
              <TabsTrigger value='rebates'>{t('Rebate orders')}</TabsTrigger>
            </TabsList>
          </Tabs>
          {props.tab === 'rebates' ? (
            <AffiliateRebatesTable />
          ) : (
            <PromotionInvitees />
          )}
        </div>
      </SectionPageLayout.Content>
    </SectionPageLayout>
  )
}
