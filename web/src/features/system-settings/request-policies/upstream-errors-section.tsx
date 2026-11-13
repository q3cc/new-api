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
import { ArrowDown, ArrowUp, Trash2 } from 'lucide-react'
import { useEffect, useMemo } from 'react'
import { useFieldArray, useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import * as z from 'zod'

import { StaticDataTable } from '@/components/data-table'
import { TagInput } from '@/components/tag-input'
import { Button } from '@/components/ui/button'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { handleServerError } from '@/lib/handle-server-error'

import { SettingsForm } from '../components/settings-form-layout'
import { SettingsPageFormActions } from '../components/settings-page-context'
import { SettingsSection } from '../components/settings-section'
import { useSavePolicy } from './use-save-policy'

// The option is stored as one "keyword => message" rule per line; the server
// splits a line at its first separator. A row here is every keyword that
// shows the same message.
const RULE_SEPARATOR = '=>'

const upstreamErrorsSchema = z.object({
  rules: z.array(
    z.object({
      keywords: z
        .array(z.string())
        .min(1, { message: 'Enter a keyword' })
        .refine(
          (keywords) =>
            keywords.every((keyword) => !keyword.includes(RULE_SEPARATOR)),
          { message: 'A keyword cannot contain =>' }
        ),
      message: z.string().trim().min(1, { message: 'Enter a message' }),
    })
  ),
})

type UpstreamErrorsFormValues = z.infer<typeof upstreamErrorsSchema>
type RewriteRule = UpstreamErrorsFormValues['rules'][number]

/** Rules that show the same message become one, at the first one's place. */
function mergeRewriteRules(rules: RewriteRule[]): RewriteRule[] {
  const merged: RewriteRule[] = []
  for (const rule of rules) {
    const message = rule.message.trim()
    const same = merged.find((other) => other.message === message)
    const target = same ?? { keywords: [], message }
    if (!same) merged.push(target)
    for (const keyword of rule.keywords) {
      if (!target.keywords.includes(keyword)) target.keywords.push(keyword)
    }
  }
  return merged
}

function parseRewriteRules(text: string): UpstreamErrorsFormValues {
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const separator = line.indexOf(RULE_SEPARATOR)
      if (separator < 0) return { keywords: [line], message: '' }
      return {
        keywords: [line.slice(0, separator).trim()],
        message: line.slice(separator + RULE_SEPARATOR.length).trim(),
      }
    })
  return { rules: mergeRewriteRules(lines) }
}

function formatRewriteRules(values: UpstreamErrorsFormValues): string {
  return mergeRewriteRules(values.rules)
    .flatMap((rule) =>
      rule.keywords.map(
        (keyword) => `${keyword} ${RULE_SEPARATOR} ${rule.message}`
      )
    )
    .join('\n')
}

type UpstreamErrorsSectionProps = {
  defaultValues: { UpstreamErrorRewriteRules: string }
}

export function UpstreamErrorsSection(props: UpstreamErrorsSectionProps) {
  const { t } = useTranslation()
  const updateOption = useSavePolicy()
  const savedText = props.defaultValues.UpstreamErrorRewriteRules
  const savedValues = useMemo(() => parseRewriteRules(savedText), [savedText])
  const form = useForm<UpstreamErrorsFormValues>({
    resolver: zodResolver(upstreamErrorsSchema),
    defaultValues: savedValues,
  })
  const rules = useFieldArray({
    control: form.control,
    name: 'rules',
    keyName: 'rowKey',
  })

  useEffect(() => {
    form.reset(savedValues)
  }, [savedValues, form])

  const onSubmit = async (values: UpstreamErrorsFormValues) => {
    const text = formatRewriteRules(values)
    if (text === formatRewriteRules(savedValues)) {
      return
    }
    try {
      await updateOption.mutateAsync({ UpstreamErrorRewriteRules: text })
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
          <div className='col-span-full min-w-0 space-y-3'>
            <div className='flex flex-wrap items-center justify-between gap-2'>
              <h3>{t('Error message rewrite rules')}</h3>
              <Button
                type='button'
                variant='outline'
                onClick={() => rules.append({ keywords: [], message: '' })}
              >
                {t('Add rule')}
              </Button>
            </div>
            <StaticDataTable
              data={rules.fields}
              getRowKey={(row) => row.rowKey}
              emptyContent={t('No rules. Upstream errors are shown unchanged.')}
              columns={[
                {
                  id: 'keywords',
                  header: t('Keywords in the upstream error'),
                  cell: (_row, index) => (
                    <FormField
                      control={form.control}
                      name={`rules.${index}.keywords`}
                      render={({ field }) => (
                        <FormItem>
                          <FormControl>
                            <TagInput
                              value={field.value}
                              onChange={field.onChange}
                              placeholder={t(
                                'Type a keyword and press Enter or a comma'
                              )}
                              inputLabel={`${t('Keywords in the upstream error')} ${index + 1}`}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  ),
                },
                {
                  id: 'message',
                  header: t('Message shown instead'),
                  cell: (_row, index) => (
                    <FormField
                      control={form.control}
                      name={`rules.${index}.message`}
                      render={({ field }) => (
                        <FormItem>
                          <FormControl>
                            <Input
                              {...field}
                              aria-label={`${t('Message shown instead')} ${index + 1}`}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  ),
                },
                {
                  id: 'actions',
                  header: t('Actions'),
                  cell: (_row, index) => (
                    <div className='flex gap-1'>
                      <Button
                        type='button'
                        variant='ghost'
                        size='icon-sm'
                        disabled={index === 0}
                        onClick={() => rules.move(index, index - 1)}
                        aria-label={`${t('Move up')} ${index + 1}`}
                      >
                        <ArrowUp />
                      </Button>
                      <Button
                        type='button'
                        variant='ghost'
                        size='icon-sm'
                        disabled={index === rules.fields.length - 1}
                        onClick={() => rules.move(index, index + 1)}
                        aria-label={`${t('Move down')} ${index + 1}`}
                      >
                        <ArrowDown />
                      </Button>
                      <Button
                        type='button'
                        variant='ghost'
                        size='icon-sm'
                        onClick={() => rules.remove(index)}
                        aria-label={`${t('Remove')} ${index + 1}`}
                      >
                        <Trash2 />
                      </Button>
                    </div>
                  ),
                },
              ]}
            />
            <p className='text-muted-foreground text-sm'>
              {t(
                'Rules are checked from top to bottom and the first one with a keyword that appears in the error applies. Rules with the same message are merged when saved.'
              )}
            </p>
          </div>
        </SettingsForm>
      </Form>
    </SettingsSection>
  )
}
