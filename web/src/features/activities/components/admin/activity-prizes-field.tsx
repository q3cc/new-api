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
import { Plus, Trash2 } from 'lucide-react'
import {
  useFieldArray,
  useWatch,
  type Control,
  type UseFormReturn,
} from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { Combobox } from '@/components/ui/combobox'
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
import { getAdminPlans } from '@/features/subscriptions/api'
import { getCurrencyLabel } from '@/lib/currency'
import { getEditableQuotaStep } from '@/lib/format'
import { requireServerSuccess } from '@/lib/server-error-message'

import { LOTTERY_MAX_PRIZES, LOTTERY_PRIZE_TYPES } from '../../constants'
import { EMPTY_PRIZE, type ActivityFormValues } from '../../lib/activity-form'
import { leaderboardRankRanges, type RankRange } from '../../lib/leaderboard'
import type { LotteryPrizeType } from '../../types'

type ActivityPrizesFieldProps = {
  form: UseFormReturn<ActivityFormValues>
}

function numberValue(value: string): number {
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function PrizeRow(props: {
  control: Control<ActivityFormValues>
  index: number
  isWheel: boolean
  /** Ranks this prize covers on a leaderboard. */
  rankRange?: RankRange
  planOptions: { value: string; label: string }[]
  plansLoading: boolean
  onRemove: () => void
  canRemove: boolean
}) {
  const { t } = useTranslation()
  const type = useWatch({
    control: props.control,
    name: `prizes.${props.index}.type`,
  })
  const prefix = `prizes.${props.index}` as const
  let quantityLabel = props.isWheel ? t('Stock (0 = unlimited)') : t('Winners')
  let rankText: string | null = null
  if (props.rankRange) {
    quantityLabel = t('Ranks covered')
    if (props.rankRange.from === props.rankRange.to) {
      rankText = t('Rank {{rank}}', { rank: props.rankRange.from })
    } else if (props.rankRange.to > props.rankRange.from) {
      rankText = t('Ranks {{from}}–{{to}}', props.rankRange)
    }
  }

  return (
    <li className='grid gap-3 rounded-md border p-3'>
      <div className='flex items-start gap-2'>
        <FormField
          control={props.control}
          name={`${prefix}.name`}
          render={({ field }) => (
            <FormItem className='flex-1'>
              <FormLabel>{t('Prize name')}</FormLabel>
              <FormControl>
                <Input {...field} placeholder={t('e.g. $5 credit')} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <Button
          type='button'
          variant='ghost'
          size='icon-sm'
          className='mt-6'
          onClick={props.onRemove}
          disabled={!props.canRemove}
          aria-label={t('Remove prize')}
        >
          <Trash2 />
        </Button>
      </div>
      <div className='grid gap-3 sm:grid-cols-2'>
        <FormField
          control={props.control}
          name={`${prefix}.type`}
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('Prize type')}</FormLabel>
              <FormControl>
                <NativeSelect
                  value={field.value}
                  name={field.name}
                  ref={field.ref}
                  onBlur={field.onBlur}
                  onChange={(event) =>
                    field.onChange(event.target.value as LotteryPrizeType)
                  }
                  className='w-full'
                >
                  {Object.entries(LOTTERY_PRIZE_TYPES).map(([value, meta]) => (
                    <NativeSelectOption key={value} value={value}>
                      {t(meta.labelKey)}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        {type === 'quota' ? (
          <FormField
            control={props.control}
            name={`${prefix}.quota_amount`}
            render={({ field }) => (
              <FormItem>
                <FormLabel>
                  {t('Quota ({{currency}})', { currency: getCurrencyLabel() })}
                </FormLabel>
                <FormControl>
                  <Input
                    type='number'
                    step={getEditableQuotaStep()}
                    value={field.value}
                    name={field.name}
                    ref={field.ref}
                    onBlur={field.onBlur}
                    onChange={(event) =>
                      field.onChange(numberValue(event.target.value))
                    }
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        ) : null}
        {type === 'subscription' ? (
          <FormField
            control={props.control}
            name={`${prefix}.plan_id`}
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('Subscription plan')}</FormLabel>
                <FormControl>
                  <Combobox
                    name={field.name}
                    ref={field.ref}
                    onBlur={field.onBlur}
                    options={props.planOptions}
                    value={field.value ? String(field.value) : null}
                    onValueChange={(value) =>
                      field.onChange(value ? Number(value) : 0)
                    }
                    disabled={props.plansLoading}
                    placeholder={
                      props.plansLoading
                        ? t('Loading...')
                        : t('Select subscription plan')
                    }
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        ) : null}
        <FormField
          control={props.control}
          name={`${prefix}.quantity`}
          render={({ field }) => (
            <FormItem>
              <FormLabel>{quantityLabel}</FormLabel>
              <FormControl>
                <Input
                  type='number'
                  min={0}
                  step={1}
                  value={field.value}
                  name={field.name}
                  ref={field.ref}
                  onBlur={field.onBlur}
                  onChange={(event) =>
                    field.onChange(Math.trunc(numberValue(event.target.value)))
                  }
                />
              </FormControl>
              {rankText ? <FormDescription>{rankText}</FormDescription> : null}
              <FormMessage />
            </FormItem>
          )}
        />
        {props.isWheel ? (
          <FormField
            control={props.control}
            name={`${prefix}.probability_percent`}
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('Probability (%)')}</FormLabel>
                <FormControl>
                  <Input
                    type='number'
                    min={0}
                    max={100}
                    step={0.01}
                    value={field.value}
                    name={field.name}
                    ref={field.ref}
                    onBlur={field.onBlur}
                    onChange={(event) =>
                      field.onChange(numberValue(event.target.value))
                    }
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        ) : null}
      </div>
    </li>
  )
}

export function ActivityPrizesField(props: ActivityPrizesFieldProps) {
  const { t } = useTranslation()
  const { fields, append, remove } = useFieldArray({
    control: props.form.control,
    name: 'prizes',
  })
  const mode = useWatch({ control: props.form.control, name: 'mode' })
  const prizes = useWatch({ control: props.form.control, name: 'prizes' })
  const { data: plans, isPending: plansLoading } = useQuery({
    queryKey: ['subscription-admin-plans'],
    queryFn: async () => requireServerSuccess(await getAdminPlans()).data ?? [],
  })
  const planOptions = (plans ?? [])
    .filter((record) => record.plan.enabled)
    .map((record) => ({
      value: String(record.plan.id),
      label: record.plan.title,
    }))
  const isWheel = mode === 'wheel'
  const rankRanges =
    mode === 'leaderboard' ? leaderboardRankRanges(prizes) : null
  const totalProbability = prizes.reduce(
    (sum, prize) => sum + (prize.probability_percent || 0),
    0
  )
  const prizesError = props.form.formState.errors.prizes?.message

  return (
    <div className='grid gap-3'>
      <ul className='grid gap-3' aria-label={t('Prizes')}>
        {fields.map((field, index) => (
          <PrizeRow
            key={field.id}
            control={props.form.control}
            index={index}
            isWheel={isWheel}
            rankRange={rankRanges?.[index]}
            planOptions={planOptions}
            plansLoading={plansLoading}
            onRemove={() => remove(index)}
            canRemove={fields.length > 1}
          />
        ))}
      </ul>
      {isWheel ? (
        <p className='text-muted-foreground text-sm'>
          {t(
            'Total probability {{total}}%; the remaining {{rest}}% wins nothing.',
            {
              total: Number(totalProbability.toFixed(2)),
              rest: Number(Math.max(100 - totalProbability, 0).toFixed(2)),
            }
          )}
        </p>
      ) : null}
      {prizesError ? (
        <p role='alert' className='text-destructive text-sm'>
          {prizesError}
        </p>
      ) : null}
      <Button
        type='button'
        variant='outline'
        size='sm'
        className='justify-self-start'
        onClick={() => append({ ...EMPTY_PRIZE })}
        disabled={fields.length >= LOTTERY_MAX_PRIZES}
      >
        <Plus className='size-4' />
        {t('Add prize')}
      </Button>
    </div>
  )
}
