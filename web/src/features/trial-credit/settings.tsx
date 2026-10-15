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
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import { ErrorState } from '@/components/error-state'
import { LoadingState } from '@/components/loading-state'
import { Combobox } from '@/components/ui/combobox'
import {
  Form,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormControl,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { SettingsForm } from '@/features/system-settings/components/settings-form-layout'
import { SettingsPageFormActions } from '@/features/system-settings/components/settings-page-context'
import { SettingsSection } from '@/features/system-settings/components/settings-section'
import { getCurrencyLabel } from '@/lib/currency'
import { handleServerError } from '@/lib/handle-server-error'

import { getTrialConfig, saveTrialConfig, type TrialConfig } from './api'
import { trialConfigSchema } from './lib/schema'
import { TrialTypeEditor } from './type-editor'

export function TrialCreditSettings(props: { groups: string[] }) {
  const query = useQuery({
    queryKey: ['trial-config'],
    queryFn: getTrialConfig,
  })
  if (query.isPending) return <LoadingState />
  if (query.isError) return <ErrorState onRetry={() => void query.refetch()} />
  return <TrialCreditSettingsForm groups={props.groups} values={query.data} />
}
function TrialCreditSettingsForm(props: {
  groups: string[]
  values: TrialConfig
}) {
  const { t } = useTranslation()
  const client = useQueryClient()
  const form = useForm<TrialConfig>({
    resolver: zodResolver(trialConfigSchema),
    defaultValues: props.values,
  })
  const kinds = form.watch('types')
  const affiliate = form.watch('affiliate')
  const mutation = useMutation({
    mutationFn: saveTrialConfig,
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['trial-config'] })
      void client.invalidateQueries({ queryKey: ['trial-types'] })
      void client.invalidateQueries({ queryKey: ['trial-balance'] })
    },
    onError: (error) => handleServerError(error),
  })
  async function submit(values: TrialConfig) {
    const saved = await mutation.mutateAsync(values)
    form.reset(saved ?? values)
  }
  return (
    <SettingsSection title={t('Trial credit')}>
      <Form {...form}>
        <SettingsForm onSubmit={form.handleSubmit(submit)}>
          <SettingsPageFormActions
            onSave={form.handleSubmit(submit)}
            isSaving={mutation.isPending}
            isSaveDisabled={!form.formState.isDirty}
            saveLabel='Save'
          />
          <FormField
            control={form.control}
            name='enabled'
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('Trial credit')}</FormLabel>
                <FormControl>
                  <Switch
                    checked={field.value}
                    onCheckedChange={field.onChange}
                  />
                </FormControl>
              </FormItem>
            )}
          />
          <TrialTypeEditor form={form} groups={props.groups} />
          <FormField
            control={form.control}
            name='affiliate'
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('AFF rewards as trial credit')}</FormLabel>
                <FormControl>
                  <Switch
                    checked={field.value}
                    onCheckedChange={field.onChange}
                  />
                </FormControl>
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name='affiliate_type_id'
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('Invitation reward kind')}</FormLabel>
                <FormControl>
                  <Combobox
                    disabled={!affiliate}
                    value={field.value ? String(field.value) : null}
                    onValueChange={(v) => field.onChange(Number(v))}
                    options={kinds
                      .filter((k) => k.id > 0 && k.enabled)
                      .map((k) => ({
                        value: String(k.id),
                        label: `${k.id} · ${t(k.name)} · ${k.group}`,
                      }))}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name='affiliate_days'
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('Validity (days, 0 = never expires)')}</FormLabel>
                <FormControl>
                  <Input
                    type='number'
                    min={0}
                    max={36500}
                    {...field}
                    onChange={(e) => field.onChange(Number(e.target.value))}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name='waive_threshold'
            render={({ field }) => (
              <FormItem>
                <FormLabel>
                  {t('Waive shortfall below ({{currency}})', {
                    currency: getCurrencyLabel(),
                  })}
                </FormLabel>
                <FormControl>
                  <Input
                    type='number'
                    min={0}
                    max={100}
                    step='any'
                    placeholder='0.5'
                    value={field.value ?? ''}
                    onChange={(event) =>
                      field.onChange(
                        event.target.value === ''
                          ? null
                          : Number(event.target.value)
                      )
                    }
                    name={field.name}
                    onBlur={field.onBlur}
                    ref={field.ref}
                  />
                </FormControl>
                <FormDescription>
                  {t(
                    'When trial credit runs out, a wallet shortfall below this amount is waived instead of carried as a negative balance. The amount is in the current display currency. Leave empty for the default; enter 0 to always charge the full amount.'
                  )}
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
        </SettingsForm>
      </Form>
    </SettingsSection>
  )
}
