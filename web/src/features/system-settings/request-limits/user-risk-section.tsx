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
import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import * as z from 'zod'

import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'

import {
  SettingsForm,
  SettingsFormGrid,
  SettingsSwitchContent,
  SettingsSwitchItem,
} from '../components/settings-form-layout'
import { SettingsPageFormActions } from '../components/settings-page-context'
import { SettingsSection } from '../components/settings-section'
import { useUpdateOption } from '../hooks/use-update-option'

const userRiskSchema = z.object({
  enabled: z.boolean(),
  window_days: z.number().int().min(1),
  shared_ip_score: z.number().int().min(0),
  same_subnet_score: z.number().int().min(0),
  multi_ip_threshold: z.number().int().min(0),
  multi_ip_score: z.number().int().min(0),
  max_score: z.number().int().min(0),
})

type UserRiskFormValues = z.infer<typeof userRiskSchema>
type UserRiskField = keyof UserRiskFormValues
type UserRiskNumberField = Exclude<UserRiskField, 'enabled'>

export type UserRiskSettingValues = {
  [K in UserRiskField as `user_risk_setting.${K}`]: UserRiskFormValues[K]
}

function toFormValues(defaults: UserRiskSettingValues): UserRiskFormValues {
  return {
    enabled: defaults['user_risk_setting.enabled'],
    window_days: defaults['user_risk_setting.window_days'],
    shared_ip_score: defaults['user_risk_setting.shared_ip_score'],
    same_subnet_score: defaults['user_risk_setting.same_subnet_score'],
    multi_ip_threshold: defaults['user_risk_setting.multi_ip_threshold'],
    multi_ip_score: defaults['user_risk_setting.multi_ip_score'],
    max_score: defaults['user_risk_setting.max_score'],
  }
}

type UserRiskSectionProps = {
  defaultValues: UserRiskSettingValues
}

export function UserRiskSection(props: UserRiskSectionProps) {
  const { t } = useTranslation()
  const updateOption = useUpdateOption()
  const numberFields: Array<{
    name: UserRiskNumberField
    label: string
    description: string
    min: number
  }> = [
    {
      name: 'window_days',
      label: t('Observation window (days)'),
      description: t('Only IPs seen within this many days are scored.'),
      min: 1,
    },
    {
      name: 'shared_ip_score',
      label: t('Score per account sharing an IP'),
      description: t('Added for each other account that used the same IP.'),
      min: 0,
    },
    {
      name: 'same_subnet_score',
      label: t('Score per account in the same IP range'),
      description: t(
        'Added for each other account in the same IPv4 /24 or IPv6 /64 that does not share an exact IP.'
      ),
      min: 0,
    },
    {
      name: 'multi_ip_threshold',
      label: t('Distinct IP threshold'),
      description: t('Distinct IPs a user may use before extra IPs add score.'),
      min: 0,
    },
    {
      name: 'multi_ip_score',
      label: t('Score per IP above the threshold'),
      description: t('Added for each distinct IP beyond the threshold.'),
      min: 0,
    },
    {
      name: 'max_score',
      label: t('Maximum score'),
      description: t('Scores are capped at this value. 0 means no cap.'),
      min: 0,
    },
  ]
  const form = useForm<UserRiskFormValues>({
    resolver: zodResolver(userRiskSchema),
    mode: 'onChange',
    defaultValues: toFormValues(props.defaultValues),
  })

  useEffect(() => {
    form.reset(toFormValues(props.defaultValues))
  }, [props.defaultValues, form])

  const onSubmit = async (values: UserRiskFormValues) => {
    const initial = toFormValues(props.defaultValues)
    for (const name of Object.keys(values) as UserRiskField[]) {
      if (values[name] !== initial[name]) {
        await updateOption.mutateAsync({
          key: `user_risk_setting.${name}`,
          value: values[name],
        })
      }
    }
    form.reset(values)
  }

  return (
    <SettingsSection title={t('User Risk Score')}>
      <Form {...form}>
        <SettingsForm onSubmit={form.handleSubmit(onSubmit)}>
          <SettingsPageFormActions
            onSave={form.handleSubmit(onSubmit)}
            isSaving={updateOption.isPending}
            isSaveDisabled={!form.formState.isDirty}
            saveLabel='Save risk score settings'
          />
          <FormField
            control={form.control}
            name='enabled'
            render={({ field }) => (
              <SettingsSwitchItem>
                <SettingsSwitchContent>
                  <FormLabel>{t('Enable user risk score')}</FormLabel>
                  <FormDescription>
                    {t(
                      'Scores are recalculated hourly from recent IPs; changes apply on the next run.'
                    )}
                  </FormDescription>
                </SettingsSwitchContent>
                <FormControl>
                  <Switch
                    checked={field.value}
                    onCheckedChange={field.onChange}
                  />
                </FormControl>
              </SettingsSwitchItem>
            )}
          />
          <SettingsFormGrid>
            {numberFields.map((item) => (
              <FormField
                key={item.name}
                control={form.control}
                name={item.name}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{item.label}</FormLabel>
                    <FormControl>
                      <Input
                        type='number'
                        min={item.min}
                        step={1}
                        {...field}
                        onChange={(e) =>
                          field.onChange(
                            Number.parseInt(e.target.value) || item.min
                          )
                        }
                      />
                    </FormControl>
                    <FormDescription>{item.description}</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            ))}
          </SettingsFormGrid>
        </SettingsForm>
      </Form>
    </SettingsSection>
  )
}
