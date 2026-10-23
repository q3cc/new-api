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
import { useWatch, type UseFormReturn } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { getCurrencyLabel } from '@/lib/currency'
import { getEditableQuotaStep } from '@/lib/format'

import { LOTTERY_RANK_METRICS } from '../../constants'
import type { ActivityFormValues } from '../../lib/activity-form'
import type { LotteryRankMetric } from '../../types'

type LeaderboardRulesFieldProps = {
  form: UseFormReturn<ActivityFormValues>
}

/** The ranking metric and the score needed to be ranked. */
export function LeaderboardRulesField(props: LeaderboardRulesFieldProps) {
  const { t } = useTranslation()
  const metric = useWatch({ control: props.form.control, name: 'rank_metric' })
  let thresholdHelp = t(
    'Money paid in successful orders, subscription purchases included. 0 = no threshold.'
  )
  let step = 0.01
  if (metric === 'invites') {
    thresholdHelp = t(
      'Invited accounts registered during the activity. 0 = no threshold.'
    )
    step = 1
  } else if (metric === 'consumption') {
    thresholdHelp = t(
      'Quota used by API calls, in {{currency}}. 0 = no threshold.',
      {
        currency: getCurrencyLabel(),
      }
    )
    step = getEditableQuotaStep()
  }

  return (
    <div className='grid gap-3 sm:grid-cols-2'>
      <FormField
        control={props.form.control}
        name='rank_metric'
        render={({ field }) => (
          <FormItem>
            <FormLabel>{t('Ranking metric')}</FormLabel>
            <FormControl>
              <NativeSelect
                value={field.value}
                name={field.name}
                ref={field.ref}
                onBlur={field.onBlur}
                onChange={(event) =>
                  field.onChange(event.target.value as LotteryRankMetric)
                }
                className='w-full'
              >
                {Object.entries(LOTTERY_RANK_METRICS).map(([value, meta]) => (
                  <NativeSelectOption key={value} value={value}>
                    {t(meta.labelKey)}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </FormControl>
            <FormDescription>
              {t(
                'Users are ranked automatically during the activity; administrators are not ranked.'
              )}
            </FormDescription>
            <FormMessage />
          </FormItem>
        )}
      />
      <FormField
        control={props.form.control}
        name='rank_min_value'
        render={({ field }) => (
          <FormItem>
            <FormLabel>{t('Minimum to be ranked')}</FormLabel>
            <FormControl>
              <Input
                type='number'
                min={0}
                step={step}
                value={field.value}
                name={field.name}
                ref={field.ref}
                onBlur={field.onBlur}
                onChange={(event) => {
                  const parsed = Number.parseFloat(event.target.value)
                  field.onChange(
                    Number.isFinite(parsed) ? Math.max(parsed, 0) : 0
                  )
                }}
              />
            </FormControl>
            <FormDescription>{thresholdHelp}</FormDescription>
            <FormMessage />
          </FormItem>
        )}
      />
    </div>
  )
}
