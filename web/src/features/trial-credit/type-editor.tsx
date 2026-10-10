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
import { useFieldArray, type UseFormReturn } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import { StaticDataTable } from '@/components/data-table'
import { Button } from '@/components/ui/button'
import { Combobox } from '@/components/ui/combobox'
import {
  FormField,
  FormItem,
  FormControl,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'

import type { TrialConfig } from './api'

export function TrialTypeEditor(props: {
  form: UseFormReturn<TrialConfig>
  groups: string[]
}) {
  const { t } = useTranslation()
  const array = useFieldArray({
    control: props.form.control,
    name: 'types',
    keyName: 'rowKey',
  })
  return (
    <div className='col-span-full min-w-0 space-y-3'>
      <div className='flex flex-wrap items-center justify-between gap-2'>
        <h3>{t('Trial credit kinds')}</h3>
        <Button
          type='button'
          variant='outline'
          onClick={() =>
            array.append({ id: 0, name: '', group: '', enabled: true })
          }
        >
          {t('Add trial credit kind')}
        </Button>
      </div>
      <StaticDataTable
        data={array.fields}
        getRowKey={(row) => row.rowKey}
        emptyContent={t('No records')}
        columns={[
          {
            id: 'id',
            header: 'ID',
            cell: (row) => row.id || t('Assigned on save'),
          },
          {
            id: 'name',
            header: t('Name'),
            cell: (_row, index) => (
              <FormField
                control={props.form.control}
                name={`types.${index}.name`}
                render={({ field }) => (
                  <FormItem>
                    <FormControl>
                      <Input
                        {...field}
                        aria-label={`${t('Trial credit name')} ${index + 1}`}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            ),
          },
          {
            id: 'group',
            header: t('Trial group'),
            cell: (_row, index) => (
              <FormField
                control={props.form.control}
                name={`types.${index}.group`}
                render={({ field }) => (
                  <FormItem>
                    <FormControl>
                      <Combobox
                        options={props.groups
                          .filter((g) => g !== 'auto')
                          .map((g) => ({ value: g, label: g }))}
                        value={field.value}
                        onValueChange={(v) => field.onChange(v ?? '')}
                        aria-label={`${t('Trial group')} ${index + 1}`}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            ),
          },
          {
            id: 'enabled',
            header: t('Allow grants'),
            cell: (_row, index) => (
              <FormField
                control={props.form.control}
                name={`types.${index}.enabled`}
                render={({ field }) => (
                  <Switch
                    checked={field.value}
                    onCheckedChange={field.onChange}
                    aria-label={`${t('Allow grants')} ${index + 1}`}
                  />
                )}
              />
            ),
          },
          {
            id: 'actions',
            header: t('Actions'),
            cell: (row, index) =>
              row.id === 0 ? (
                <Button
                  type='button'
                  variant='ghost'
                  onClick={() => array.remove(index)}
                >
                  {t('Remove')}
                </Button>
              ) : null,
          },
        ]}
      />
      <p className='text-muted-foreground text-sm'>
        {t(
          'Each kind is used only in its assigned group. Disabling grants keeps existing credit usable.'
        )}
      </p>
    </div>
  )
}
