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
import { type Resolver, useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import * as z from 'zod'

import { Alert, AlertDescription } from '@/components/ui/alert'
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
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'
import { formatQuota } from '@/lib/format'

import {
  SettingsForm,
  SettingsFormGrid,
  SettingsSwitchContent,
  SettingsSwitchItem,
} from '../components/settings-form-layout'
import { SettingsPageFormActions } from '../components/settings-page-context'
import { SettingsSection } from '../components/settings-section'
import { useUpdateOption } from '../hooks/use-update-option'

const affiliateRebateSchema = z.object({
  // One-off quota granted when an invited user registers.
  inviter_reward: z.number().int().min(0),
  invitee_reward: z.number().int().min(0),
  enabled: z.boolean(),
  // Kept as typed so decimals like "1." can be entered, then coerced.
  rate_percent: z.coerce
    .number()
    .min(0, 'Rebate rate must be between 0 and 100')
    .max(100, 'Rebate rate must be between 0 and 100')
    .refine(
      (value) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-6,
      'Rebate rate allows at most two decimal places'
    ),
  confirm_days: z
    .number()
    .int()
    .min(0, 'Confirmation period must be between 0 and 90 days')
    .max(90, 'Confirmation period must be between 0 and 90 days'),
  risk_review_score: z.number().int().min(0),
  cancel_shared_ip: z.boolean(),
})

type AffiliateRebateFormValues = z.infer<typeof affiliateRebateSchema>
type AffiliateRebateField = keyof AffiliateRebateFormValues
type AffiliateRewardField = 'inviter_reward' | 'invitee_reward'
type AffiliateRebateNumberField = Exclude<
  AffiliateRebateField,
  'enabled' | 'cancel_shared_ip' | AffiliateRewardField
>

// The invitation rewards keep their original top-level option keys.
const OPTION_KEYS = {
  inviter_reward: 'QuotaForInviter',
  invitee_reward: 'QuotaForInvitee',
  enabled: 'affiliate_rebate_setting.enabled',
  rate_percent: 'affiliate_rebate_setting.rate_percent',
  confirm_days: 'affiliate_rebate_setting.confirm_days',
  risk_review_score: 'affiliate_rebate_setting.risk_review_score',
  cancel_shared_ip: 'affiliate_rebate_setting.cancel_shared_ip',
} as const satisfies Record<AffiliateRebateField, string>

export type AffiliateRebateSettingValues = {
  [
    K in AffiliateRebateField as (typeof OPTION_KEYS)[K]
  ]: AffiliateRebateFormValues[K]
}

function toFormValues(
  defaults: AffiliateRebateSettingValues
): AffiliateRebateFormValues {
  return {
    inviter_reward: defaults.QuotaForInviter,
    invitee_reward: defaults.QuotaForInvitee,
    enabled: defaults['affiliate_rebate_setting.enabled'],
    rate_percent: defaults['affiliate_rebate_setting.rate_percent'],
    confirm_days: defaults['affiliate_rebate_setting.confirm_days'],
    risk_review_score: defaults['affiliate_rebate_setting.risk_review_score'],
    cancel_shared_ip: defaults['affiliate_rebate_setting.cancel_shared_ip'],
  }
}

type AffiliateRebateSectionProps = {
  defaultValues: AffiliateRebateSettingValues
  complianceConfirmed?: boolean
}

export function AffiliateRebateSection(props: AffiliateRebateSectionProps) {
  const { t } = useTranslation()
  const updateOption = useUpdateOption()
  const complianceConfirmed = props.complianceConfirmed ?? true
  const rewardFields: Array<{
    name: AffiliateRewardField
    label: string
    describe: (formattedQuota: string) => string
  }> = [
    {
      name: 'inviter_reward',
      label: t('Inviter Reward'),
      describe: (formattedQuota) =>
        t('Quota given to users who invite others ({{formattedQuota}})', {
          formattedQuota,
        }),
    },
    {
      name: 'invitee_reward',
      label: t('Invitee Reward'),
      describe: (formattedQuota) =>
        t('Quota given to invited users ({{formattedQuota}})', {
          formattedQuota,
        }),
    },
  ]
  const numberFields: Array<{
    name: AffiliateRebateNumberField
    label: string
    description: string
    step: number
    parse: (value: string) => number | string
  }> = [
    {
      name: 'rate_percent',
      label: t('Rebate rate (%)'),
      description: t(
        "Share of each paid top-up or subscription's credited quota, up to two decimal places."
      ),
      step: 0.01,
      parse: (value) => value,
    },
    {
      name: 'confirm_days',
      label: t('Confirmation period (days)'),
      description: t(
        'Days a rebate waits before it is credited to the inviter. 0 credits it on the next check.'
      ),
      step: 1,
      parse: (value) => Number.parseInt(value) || 0,
    },
    {
      name: 'risk_review_score',
      label: t('Review at risk score'),
      description: t(
        "Rebates whose invitee's risk score reaches this value wait for administrator review. 0 never sends them to review."
      ),
      step: 1,
      parse: (value) => Number.parseInt(value) || 0,
    },
  ]
  const form = useForm<AffiliateRebateFormValues>({
    // The rate is coerced from its typed text, so the input type differs.
    resolver: zodResolver(affiliateRebateSchema) as Resolver<
      AffiliateRebateFormValues,
      unknown,
      AffiliateRebateFormValues
    >,
    mode: 'onChange',
    defaultValues: toFormValues(props.defaultValues),
  })

  useEffect(() => {
    form.reset(toFormValues(props.defaultValues))
  }, [props.defaultValues, form])

  const onSubmit = async (values: AffiliateRebateFormValues) => {
    const initial = toFormValues(props.defaultValues)
    for (const name of Object.keys(values) as AffiliateRebateField[]) {
      if (values[name] !== initial[name]) {
        await updateOption.mutateAsync({
          key: OPTION_KEYS[name],
          value: values[name],
        })
      }
    }
    form.reset(values)
  }

  return (
    <SettingsSection title={t('Referral Rebates')}>
      {!complianceConfirmed ? (
        <Alert variant='destructive'>
          <AlertDescription>
            {t(
              'Referral rebates and non-zero invitation rewards require compliance confirmation in Payment Gateway settings.'
            )}
          </AlertDescription>
        </Alert>
      ) : null}
      <Form {...form}>
        <SettingsForm onSubmit={form.handleSubmit(onSubmit)}>
          <SettingsPageFormActions
            onSave={form.handleSubmit(onSubmit)}
            isSaving={updateOption.isPending}
            isSaveDisabled={!form.formState.isDirty}
            saveLabel='Save referral rebate settings'
          />
          <SettingsFormGrid>
            {rewardFields.map((item) => (
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
                        min={0}
                        step={1}
                        {...field}
                        onChange={(e) =>
                          field.onChange(Number.parseInt(e.target.value) || 0)
                        }
                      />
                    </FormControl>
                    <FormDescription>
                      {item.describe(formatQuota(field.value))}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            ))}
          </SettingsFormGrid>
          <Separator />
          <FormField
            control={form.control}
            name='enabled'
            render={({ field }) => (
              <SettingsSwitchItem>
                <SettingsSwitchContent>
                  <FormLabel>{t('Enable referral rebates')}</FormLabel>
                  <FormDescription>
                    {t(
                      'Inviters earn a share of every online top-up and subscription paid by the users they invited.'
                    )}
                  </FormDescription>
                </SettingsSwitchContent>
                <FormControl>
                  <Switch
                    checked={field.value}
                    onCheckedChange={field.onChange}
                    disabled={!complianceConfirmed && !field.value}
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
                        min={0}
                        step={item.step}
                        {...field}
                        onChange={(e) =>
                          field.onChange(item.parse(e.target.value))
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
          <FormField
            control={form.control}
            name='cancel_shared_ip'
            render={({ field }) => (
              <SettingsSwitchItem>
                <SettingsSwitchContent>
                  <FormLabel>{t('Cancel invitations sharing an IP')}</FormLabel>
                  <FormDescription>
                    {t(
                      'Cancels an invitation once the inviter and the invitee are seen on the same public IP. Applies even when rebates are off.'
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
        </SettingsForm>
      </Form>
    </SettingsSection>
  )
}
