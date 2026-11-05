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
import { Textarea } from '@/components/ui/textarea'
import { handleServerError } from '@/lib/handle-server-error'

import { SettingsForm } from '../components/settings-form-layout'
import { SettingsPageFormActions } from '../components/settings-page-context'
import { SettingsSection } from '../components/settings-section'
import { useSavePolicy } from './use-save-policy'

/** A rule line is "keyword => message"; the server applies the same rule. */
function isRewriteRuleLine(line: string): boolean {
  const separator = line.indexOf('=>')
  return (
    separator > 0 &&
    line.slice(0, separator).trim() !== '' &&
    line.slice(separator + 2).trim() !== ''
  )
}

const upstreamErrorsSchema = z.object({
  UpstreamErrorRewriteRules: z.string().refine(
    (value) =>
      value
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .every(isRewriteRuleLine),
    { message: 'Each line must be written as keyword => message' }
  ),
})

type UpstreamErrorsFormValues = z.infer<typeof upstreamErrorsSchema>

type UpstreamErrorsSectionProps = {
  defaultValues: UpstreamErrorsFormValues
}

export function UpstreamErrorsSection(props: UpstreamErrorsSectionProps) {
  const { t } = useTranslation()
  const updateOption = useSavePolicy()
  const form = useForm<UpstreamErrorsFormValues>({
    resolver: zodResolver(upstreamErrorsSchema),
    defaultValues: props.defaultValues,
  })

  useEffect(() => {
    form.reset(props.defaultValues)
  }, [props.defaultValues, form])

  const onSubmit = async (values: UpstreamErrorsFormValues) => {
    if (
      values.UpstreamErrorRewriteRules ===
      props.defaultValues.UpstreamErrorRewriteRules
    ) {
      return
    }
    try {
      await updateOption.mutateAsync({
        UpstreamErrorRewriteRules: values.UpstreamErrorRewriteRules,
      })
    } catch (error) {
      handleServerError(error)
    }
  }

  return (
    <SettingsSection title={t('Upstream errors')}>
      <p className='text-muted-foreground text-sm'>
        {t('Source: global settings. Changes take effect after saving.')}
      </p>
      <p className='text-muted-foreground text-sm'>
        {t(
          'Replaces an upstream error message that contains a keyword, ignoring case, with your own message. The status code and retries are unchanged, and administrators still see the original message in the log details.'
        )}
      </p>
      <Form {...form}>
        <SettingsForm onSubmit={form.handleSubmit(onSubmit)}>
          <SettingsPageFormActions
            onSave={form.handleSubmit(onSubmit)}
            isSaving={form.formState.isSubmitting}
          />
          <FormField
            control={form.control}
            name='UpstreamErrorRewriteRules'
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('Error message rewrite rules')}</FormLabel>
                <FormControl>
                  <Textarea
                    rows={10}
                    placeholder='content policy => 会话被模型提供商云端拦截，请修改后重新尝试'
                    {...field}
                  />
                </FormControl>
                <FormDescription>
                  {t(
                    'One rule per line: keyword => message. The first matching rule applies. Leave blank to show upstream errors unchanged.'
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
