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
import { z } from 'zod'

import { ErrorState } from '@/components/error-state'
import { LoadingState } from '@/components/loading-state'
import {
  Form,
  FormField,
  FormItem,
  FormLabel,
  FormControl,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { SettingsForm } from '@/features/system-settings/components/settings-form-layout'
import { SettingsPageFormActions } from '@/features/system-settings/components/settings-page-context'
import { SettingsSection } from '@/features/system-settings/components/settings-section'
import { handleServerError } from '@/lib/handle-server-error'

import { getTrialConfig, saveTrialConfig, type TrialConfig } from './api'

const schema = z.object({
  enabled: z.boolean(),
  group: z.string(),
  affiliate: z.boolean(),
  affiliate_days: z.number().int().min(0).max(36500),
})
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
    resolver: zodResolver(schema),
    defaultValues: props.values,
  })
  const mutation = useMutation({
    mutationFn: saveTrialConfig,
    onSuccess: () => client.invalidateQueries({ queryKey: ['trial-config'] }),
    onError: (error) => handleServerError(error),
  })
  async function submit(values: TrialConfig) {
    await mutation.mutateAsync(values)
    form.reset(values)
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
          <FormField
            control={form.control}
            name='group'
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('Trial group')}</FormLabel>
                <Select value={field.value} onValueChange={field.onChange}>
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {props.groups
                      .filter((g) => g !== 'auto')
                      .map((g) => (
                        <SelectItem key={g} value={g}>
                          {g}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
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
        </SettingsForm>
      </Form>
    </SettingsSection>
  )
}
