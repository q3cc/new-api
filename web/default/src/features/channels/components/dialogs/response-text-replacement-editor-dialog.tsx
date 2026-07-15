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
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Dialog } from '@/components/dialog'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'

import type {
  ResponseTextReplacementRule,
  ResponseTextReplacementScope,
} from '../../types'

type RuleDraft = ResponseTextReplacementRule & { id: string }

type ResponseTextReplacementEditorDialogProps = {
  open: boolean
  rules: ResponseTextReplacementRule[]
  onOpenChange: (open: boolean) => void
  onSave: (rules: ResponseTextReplacementRule[]) => void
}

const SCOPE_OPTIONS: Array<{
  value: ResponseTextReplacementScope
  label: string
}> = [
  { value: 'error', label: 'Errors only' },
  { value: 'response', label: 'Successful responses only' },
  { value: 'all', label: 'All responses' },
]

let nextRuleId = 0

function createRuleDraft(
  rule: Partial<ResponseTextReplacementRule> = {}
): RuleDraft {
  nextRuleId += 1
  return {
    id: `response-replacement-${nextRuleId}`,
    pattern: rule.pattern || '',
    replacement: rule.replacement || '',
    scope: rule.scope || 'all',
  }
}

export function ResponseTextReplacementEditorDialog(
  props: ResponseTextReplacementEditorDialogProps
) {
  const { t } = useTranslation()
  const [drafts, setDrafts] = useState<RuleDraft[]>(() =>
    props.rules.map((rule) => createRuleDraft(rule))
  )

  useEffect(() => {
    if (props.open) {
      setDrafts(props.rules.map((rule) => createRuleDraft(rule)))
    }
  }, [props.open, props.rules])

  const updateRule = (id: string, patch: Partial<RuleDraft>) => {
    setDrafts((current) =>
      current.map((rule) => (rule.id === id ? { ...rule, ...patch } : rule))
    )
  }

  const moveRule = (index: number, offset: -1 | 1) => {
    const target = index + offset
    if (target < 0 || target >= drafts.length) return
    setDrafts((current) => {
      const next = [...current]
      ;[next[index], next[target]] = [next[target], next[index]]
      return next
    })
  }

  const saveRules = () => {
    if (drafts.some((rule) => !rule.pattern)) {
      toast.error(t('Regex pattern is required'))
      return
    }
    props.onSave(
      drafts.map((rule) => ({
        pattern: rule.pattern,
        replacement: rule.replacement,
        scope: rule.scope,
      }))
    )
    props.onOpenChange(false)
  }

  return (
    <Dialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      title={t('Response text replacement')}
      description={t(
        'Apply ordered regular expression replacements to text returned by this channel.'
      )}
      contentClassName='sm:max-w-3xl'
      contentHeight='min(36rem, calc(100vh - 15rem))'
      footer={
        <>
          <Button
            type='button'
            variant='outline'
            onClick={() => props.onOpenChange(false)}
          >
            {t('Cancel')}
          </Button>
          <Button type='button' onClick={saveRules}>
            {t('Save rules')}
          </Button>
        </>
      }
    >
      <div className='space-y-4'>
        <Alert>
          <AlertDescription>
            {t(
              'Rules use RE2 syntax, replace every match, and support capture references such as $1. Replacements run on the upstream text before response parsing.'
            )}
          </AlertDescription>
        </Alert>

        {drafts.length === 0 ? (
          <div className='text-muted-foreground border-border flex min-h-28 items-center justify-center border border-dashed p-6 text-center text-sm'>
            {t('No response text replacement rules configured.')}
          </div>
        ) : (
          <div className='space-y-3'>
            {drafts.map((rule, index) => (
              <div key={rule.id} className='border-border space-y-3 border p-4'>
                <div className='flex items-center justify-between gap-3'>
                  <span className='text-sm font-medium'>
                    {t('Rule {{index}}', { index: index + 1 })}
                  </span>
                  <div className='flex items-center gap-1'>
                    <Button
                      type='button'
                      size='icon-sm'
                      variant='ghost'
                      disabled={index === 0}
                      aria-label={t('Move rule up')}
                      onClick={() => moveRule(index, -1)}
                    >
                      <ArrowUp aria-hidden='true' />
                    </Button>
                    <Button
                      type='button'
                      size='icon-sm'
                      variant='ghost'
                      disabled={index === drafts.length - 1}
                      aria-label={t('Move rule down')}
                      onClick={() => moveRule(index, 1)}
                    >
                      <ArrowDown aria-hidden='true' />
                    </Button>
                    <Button
                      type='button'
                      size='icon-sm'
                      variant='ghost'
                      aria-label={t('Delete rule')}
                      onClick={() =>
                        setDrafts((current) =>
                          current.filter((item) => item.id !== rule.id)
                        )
                      }
                    >
                      <Trash2 aria-hidden='true' />
                    </Button>
                  </div>
                </div>

                <div className='grid gap-3 sm:grid-cols-[minmax(0,1fr)_13rem]'>
                  <label className='space-y-1.5 text-sm'>
                    <span className='font-medium'>{t('Regex pattern')}</span>
                    <Textarea
                      value={rule.pattern}
                      rows={2}
                      className='resize-y font-mono text-xs'
                      placeholder={t('e.g., upstream model: ([^"\\s]+)')}
                      onChange={(event) =>
                        updateRule(rule.id, { pattern: event.target.value })
                      }
                    />
                  </label>
                  <label className='space-y-1.5 text-sm'>
                    <span className='font-medium'>{t('Apply to')}</span>
                    <Select
                      items={SCOPE_OPTIONS.map((option) => ({
                        value: option.value,
                        label: t(option.label),
                      }))}
                      value={rule.scope}
                      onValueChange={(value) => {
                        if (value) {
                          updateRule(rule.id, {
                            scope: value as ResponseTextReplacementScope,
                          })
                        }
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent alignItemWithTrigger={false}>
                        <SelectGroup>
                          {SCOPE_OPTIONS.map((option) => (
                            <SelectItem key={option.value} value={option.value}>
                              {t(option.label)}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  </label>
                </div>

                <label className='block space-y-1.5 text-sm'>
                  <span className='font-medium'>{t('Replace with')}</span>
                  <Input
                    value={rule.replacement}
                    className='font-mono text-xs'
                    placeholder={t('Leave empty to remove matched text')}
                    onChange={(event) =>
                      updateRule(rule.id, { replacement: event.target.value })
                    }
                  />
                </label>
              </div>
            ))}
          </div>
        )}

        <Button
          type='button'
          variant='outline'
          disabled={drafts.length >= 50}
          onClick={() =>
            setDrafts((current) => [...current, createRuleDraft()])
          }
        >
          <Plus aria-hidden='true' className='mr-2 h-4 w-4' />
          {t('Add replacement rule')}
        </Button>
      </div>
    </Dialog>
  )
}
