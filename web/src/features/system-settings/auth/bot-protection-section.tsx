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
import { useEffect, useMemo } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

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
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

import { SettingsForm } from '../components/settings-form-layout'
import { SettingsPageFormActions } from '../components/settings-page-context'
import { SettingsSection } from '../components/settings-section'
import { useUpdateOption } from '../hooks/use-update-option'
import {
  botProtectionSchema,
  buildBotProtectionUpdates,
  toBotProtectionFormValues,
  type BotProtectionChoice,
  type BotProtectionFormValues,
  type BotProtectionOptions,
} from './bot-protection-options'

type BotProtectionSectionProps = {
  defaultValues: BotProtectionOptions
}

export function BotProtectionSection(props: BotProtectionSectionProps) {
  const { t } = useTranslation()
  const updateOption = useUpdateOption()
  const formDefaults = useMemo(
    () => toBotProtectionFormValues(props.defaultValues),
    [props.defaultValues]
  )

  const form = useForm<BotProtectionFormValues>({
    resolver: zodResolver(botProtectionSchema),
    defaultValues: formDefaults,
  })

  useEffect(() => {
    form.reset(formDefaults)
  }, [formDefaults, form])

  const provider = form.watch('provider')

  const onSubmit = async (values: BotProtectionFormValues) => {
    for (const [key, value] of buildBotProtectionUpdates(
      props.defaultValues,
      values
    )) {
      await updateOption.mutateAsync({ key, value })
    }
  }

  const providerItems: { value: BotProtectionChoice; label: string }[] = [
    { value: 'none', label: t('Off') },
    { value: 'turnstile', label: 'Cloudflare Turnstile' },
    { value: 'geetest', label: t('GeeTest v4') },
    { value: 'recaptcha', label: t('Google reCAPTCHA v2') },
  ]
  const keepSecretPlaceholder = t('Leave empty to keep the saved value')

  return (
    <SettingsSection title={t('Bot Protection')}>
      <Form {...form}>
        <SettingsForm onSubmit={form.handleSubmit(onSubmit)} autoComplete='off'>
          <SettingsPageFormActions
            onSave={form.handleSubmit(onSubmit)}
            isSaving={updateOption.isPending}
          />
          <FormField
            control={form.control}
            name='provider'
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('Human verification provider')}</FormLabel>
                <Select
                  items={providerItems}
                  value={field.value}
                  onValueChange={(value) => field.onChange(value)}
                >
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent alignItemWithTrigger={false}>
                    <SelectGroup>
                      {providerItems.map((item) => (
                        <SelectItem key={item.value} value={item.value}>
                          {item.label}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
                <FormDescription>
                  {t(
                    'Protect login, registration, email codes, password reset and check-in with a human check'
                  )}
                </FormDescription>
              </FormItem>
            )}
          />

          {provider === 'turnstile' && (
            <>
              <FormField
                control={form.control}
                name='turnstileSiteKey'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('Site Key')}</FormLabel>
                    <FormControl>
                      <Input
                        placeholder={t('Your Turnstile site key')}
                        autoComplete='off'
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name='turnstileSecretKey'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('Secret Key')}</FormLabel>
                    <FormControl>
                      <Input
                        type='password'
                        placeholder={t('Your Turnstile secret key')}
                        autoComplete='new-password'
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </>
          )}

          {provider === 'geetest' && (
            <>
              <FormField
                control={form.control}
                name='geetestCaptchaId'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('GeeTest ID')}</FormLabel>
                    <FormControl>
                      <Input autoComplete='off' {...field} />
                    </FormControl>
                    <FormDescription>
                      {t(
                        'The captcha_id and captcha_key of a GeeTest v4 scenario, from the GeeTest console'
                      )}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name='geetestSecret'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('GeeTest KEY')}</FormLabel>
                    <FormControl>
                      <Input
                        type='password'
                        placeholder={keepSecretPlaceholder}
                        autoComplete='new-password'
                        {...field}
                      />
                    </FormControl>
                    <FormDescription>
                      {t(
                        'If GeeTest cannot be reached, protected requests are refused instead of skipping the check'
                      )}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </>
          )}

          {provider === 'recaptcha' && (
            <>
              <FormField
                control={form.control}
                name='recaptchaSiteKey'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('Site Key')}</FormLabel>
                    <FormControl>
                      <Input autoComplete='off' {...field} />
                    </FormControl>
                    <FormDescription>
                      {t(
                        'A reCAPTCHA v2 checkbox key. The widget and verification use www.recaptcha.net, which is reachable from mainland China'
                      )}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name='recaptchaSecret'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('Secret Key')}</FormLabel>
                    <FormControl>
                      <Input
                        type='password'
                        placeholder={keepSecretPlaceholder}
                        autoComplete='new-password'
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </>
          )}
        </SettingsForm>
      </Form>
    </SettingsSection>
  )
}
