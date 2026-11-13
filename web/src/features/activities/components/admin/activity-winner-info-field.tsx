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
import { type UseFormReturn, useFieldArray, useWatch } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import { StaticDataTable } from '@/components/data-table'
import { Button } from '@/components/ui/button'
import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'

import type { ActivityFormValues } from '../../lib/activity-form'

const MAX_WINNER_FIELDS = 10

/**
 * What winners are told and asked for. It stays editable after people have
 * entered, because it changes nothing about how the activity is won.
 */
export function ActivityWinnerInfoField(props: {
  form: UseFormReturn<ActivityFormValues>
}) {
  const { t } = useTranslation()
  const fields = useFieldArray({
    control: props.form.control,
    name: 'winner_fields',
    keyName: 'rowKey',
  })
  const prizes = useWatch({ control: props.form.control, name: 'prizes' })
  const hasManualPrize = prizes.some((prize) => prize.type === 'manual')
  return (
    <>
      <FormField
        control={props.form.control}
        name='winner_notice'
        render={({ field }) => (
          <FormItem>
            <FormLabel>{t('Winner notice')}</FormLabel>
            <FormControl>
              <Textarea {...field} rows={3} />
            </FormControl>
            <FormDescription>
              {t(
                'Shown to winners with their prize and included in the email they receive, for example how and when the prize is sent.'
              )}
            </FormDescription>
            <FormMessage />
          </FormItem>
        )}
      />
      {hasManualPrize ? (
        <div className='min-w-0 space-y-3'>
          <div className='flex flex-wrap items-center justify-between gap-2'>
            <h4 className='text-sm font-medium'>
              {t('Information for manually delivered prizes')}
            </h4>
            <Button
              type='button'
              variant='outline'
              size='sm'
              disabled={fields.fields.length >= MAX_WINNER_FIELDS}
              onClick={() => fields.append({ label: '', required: true })}
            >
              {t('Add information')}
            </Button>
          </div>
          <StaticDataTable
            data={fields.fields}
            getRowKey={(row) => row.rowKey}
            emptyContent={t('Winners are not asked for anything.')}
            columns={[
              {
                id: 'label',
                header: t('Name'),
                cell: (_row, index) => (
                  <FormField
                    control={props.form.control}
                    name={`winner_fields.${index}.label`}
                    render={({ field }) => (
                      <FormItem>
                        <FormControl>
                          <Input
                            {...field}
                            placeholder={t('Shipping address')}
                            aria-label={`${t('Information name')} ${index + 1}`}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                ),
              },
              {
                id: 'required',
                header: t('Required'),
                cell: (_row, index) => (
                  <FormField
                    control={props.form.control}
                    name={`winner_fields.${index}.required`}
                    render={({ field }) => (
                      <Switch
                        checked={field.value}
                        onCheckedChange={field.onChange}
                        aria-label={`${t('Required')} ${index + 1}`}
                      />
                    )}
                  />
                ),
              },
              {
                id: 'actions',
                header: t('Actions'),
                cell: (_row, index) => (
                  <Button
                    type='button'
                    variant='ghost'
                    onClick={() => fields.remove(index)}
                    aria-label={`${t('Remove')} ${index + 1}`}
                  >
                    {t('Remove')}
                  </Button>
                ),
              },
            ]}
          />
          <p className='text-muted-foreground text-sm'>
            {t(
              'Winners of manually delivered prizes fill this in under My prizes after the message and email they get when the activity is drawn. You see it in the entries of the activity.'
            )}
          </p>
        </div>
      ) : (
        <p className='text-muted-foreground text-sm'>
          {t(
            'Winners fill in information only for manually delivered prizes. Add a prize of that type to ask for it.'
          )}
        </p>
      )}
    </>
  )
}
