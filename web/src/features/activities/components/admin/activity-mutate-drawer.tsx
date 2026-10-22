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
import { useMutation } from '@tanstack/react-query'
import { useEffect } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { DateTimePicker } from '@/components/datetime-picker'
import {
  SideDrawerSection,
  SideDrawerSectionHeader,
  sideDrawerContentClassName,
  sideDrawerFooterClassName,
  sideDrawerFormClassName,
  sideDrawerHeaderClassName,
} from '@/components/drawer-layout'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
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
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Textarea } from '@/components/ui/textarea'
import { handleServerError } from '@/lib/handle-server-error'
import { requireServerSuccess } from '@/lib/server-error-message'

import { createActivity, updateActivity } from '../../api'
import { LOTTERY_MODES } from '../../constants'
import {
  ACTIVITY_FORM_DEFAULT_VALUES,
  activityFormToPayload,
  activityToFormValues,
  getActivityFormSchema,
  type ActivityFormValues,
} from '../../lib/activity-form'
import type { LotteryActivity, LotteryMode } from '../../types'
import { ActivityPrizesField } from './activity-prizes-field'

type ActivityMutateDrawerProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  activity?: LotteryActivity
  onSaved: () => void
}

function integerValue(value: string): number {
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) ? Math.max(parsed, 0) : 0
}

export function ActivityMutateDrawer(props: ActivityMutateDrawerProps) {
  const { t } = useTranslation()
  const isUpdate = props.activity !== undefined
  // Entrants keep the rules they joined under.
  const locked = (props.activity?.entry_count ?? 0) > 0
  const form = useForm<ActivityFormValues>({
    resolver: zodResolver(getActivityFormSchema(t)),
    defaultValues: ACTIVITY_FORM_DEFAULT_VALUES,
  })
  const mode = useWatch({ control: form.control, name: 'mode' })
  const minSpend = useWatch({ control: form.control, name: 'min_spend' })

  useEffect(() => {
    if (!props.open) return
    form.reset(
      props.activity
        ? activityToFormValues(props.activity)
        : ACTIVITY_FORM_DEFAULT_VALUES
    )
  }, [props.open, props.activity, form])

  const save = useMutation({
    mutationFn: async (values: ActivityFormValues) => {
      const payload = activityFormToPayload(values)
      if (props.activity) {
        return requireServerSuccess(
          await updateActivity(props.activity.id, payload)
        )
      }
      return requireServerSuccess(await createActivity(payload))
    },
    onSuccess: () => {
      toast.success(isUpdate ? t('Activity updated') : t('Activity created'))
      props.onOpenChange(false)
      props.onSaved()
    },
    onError: (error) => handleServerError(error),
  })

  return (
    <Sheet open={props.open} onOpenChange={props.onOpenChange}>
      <SheetContent className={sideDrawerContentClassName('sm:max-w-[640px]')}>
        <SheetHeader className={sideDrawerHeaderClassName()}>
          <SheetTitle>
            {isUpdate ? t('Edit activity') : t('Create activity')}
          </SheetTitle>
          <SheetDescription>
            {t(
              'Set the prizes, the entry requirement and how winners are drawn.'
            )}
          </SheetDescription>
        </SheetHeader>
        <Form {...form}>
          <form
            id='activity-form'
            onSubmit={form.handleSubmit((values) => save.mutate(values))}
            className={sideDrawerFormClassName()}
          >
            <fieldset disabled={save.isPending} className='contents'>
              {locked ? (
                <Alert>
                  <AlertDescription>
                    {t(
                      'Users have entered this activity, so only the title, description and end time can change.'
                    )}
                  </AlertDescription>
                </Alert>
              ) : null}
              <SideDrawerSection>
                <FormField
                  control={form.control}
                  name='title'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('Title')}</FormLabel>
                      <FormControl>
                        <Input {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name='description'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('Description')}</FormLabel>
                      <FormControl>
                        <Textarea {...field} rows={3} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name='end_time'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('End time')}</FormLabel>
                      <FormControl>
                        <DateTimePicker
                          value={field.value}
                          onChange={field.onChange}
                          placeholder={t('No end time')}
                        />
                      </FormControl>
                      <FormDescription>
                        {mode === 'scheduled'
                          ? t(
                              'Entries close at this time or at the draw time, whichever is earlier.'
                            )
                          : t('Leave empty to keep the activity open.')}
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </SideDrawerSection>

              <fieldset disabled={locked} className='contents'>
                <SideDrawerSection>
                  <SideDrawerSectionHeader title={t('Draw rules')} />
                  <FormField
                    control={form.control}
                    name='mode'
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t('Draw method')}</FormLabel>
                        <FormControl>
                          <RadioGroup
                            value={field.value}
                            onValueChange={(value) =>
                              field.onChange(value as LotteryMode)
                            }
                            disabled={locked}
                            aria-label={t('Draw method')}
                            className='flex flex-wrap gap-4'
                          >
                            {Object.entries(LOTTERY_MODES).map(
                              ([value, meta]) => (
                                <div
                                  key={value}
                                  className='flex items-center gap-2'
                                >
                                  <RadioGroupItem
                                    id={`activity-mode-${value}`}
                                    value={value}
                                  />
                                  <Label htmlFor={`activity-mode-${value}`}>
                                    {t(meta.labelKey)}
                                  </Label>
                                </div>
                              )
                            )}
                          </RadioGroup>
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name='status'
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t('Status')}</FormLabel>
                        <FormControl>
                          <RadioGroup
                            value={field.value}
                            onValueChange={field.onChange}
                            disabled={locked}
                            aria-label={t('Status')}
                            className='flex gap-4'
                          >
                            <div className='flex items-center gap-2'>
                              <RadioGroupItem
                                id='activity-status-active'
                                value='active'
                              />
                              <Label htmlFor='activity-status-active'>
                                {t('Published')}
                              </Label>
                            </div>
                            <div className='flex items-center gap-2'>
                              <RadioGroupItem
                                id='activity-status-draft'
                                value='draft'
                              />
                              <Label htmlFor='activity-status-draft'>
                                {t('Draft')}
                              </Label>
                            </div>
                          </RadioGroup>
                        </FormControl>
                        <FormDescription>
                          {t('Drafts are hidden from users.')}
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name='start_time'
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t('Start time')}</FormLabel>
                        <FormControl>
                          <DateTimePicker
                            value={field.value}
                            onChange={field.onChange}
                            placeholder={t('Starts immediately')}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  {mode === 'scheduled' ? (
                    <FormField
                      control={form.control}
                      name='draw_time'
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>{t('Draw time')}</FormLabel>
                          <FormControl>
                            <DateTimePicker
                              value={field.value}
                              onChange={field.onChange}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  ) : null}
                  {mode === 'participants' ? (
                    <FormField
                      control={form.control}
                      name='target_participants'
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>{t('Participant target')}</FormLabel>
                          <FormControl>
                            <Input
                              type='number'
                              min={1}
                              value={field.value}
                              name={field.name}
                              ref={field.ref}
                              onBlur={field.onBlur}
                              onChange={(event) =>
                                field.onChange(integerValue(event.target.value))
                              }
                            />
                          </FormControl>
                          <FormDescription>
                            {t(
                              'Drawn as soon as this many users have joined, or at the end time with whoever joined.'
                            )}
                          </FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  ) : null}
                  {mode === 'wheel' ? (
                    <div className='grid gap-3 sm:grid-cols-2'>
                      <FormField
                        control={form.control}
                        name='wheel_total_limit'
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>{t('Spins per user')}</FormLabel>
                            <FormControl>
                              <Input
                                type='number'
                                min={0}
                                value={field.value}
                                name={field.name}
                                ref={field.ref}
                                onBlur={field.onBlur}
                                onChange={(event) =>
                                  field.onChange(
                                    integerValue(event.target.value)
                                  )
                                }
                              />
                            </FormControl>
                            <FormDescription>
                              {t('0 = unlimited')}
                            </FormDescription>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name='wheel_daily_limit'
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>{t('Spins per user per day')}</FormLabel>
                            <FormControl>
                              <Input
                                type='number'
                                min={0}
                                value={field.value}
                                name={field.name}
                                ref={field.ref}
                                onBlur={field.onBlur}
                                onChange={(event) =>
                                  field.onChange(
                                    integerValue(event.target.value)
                                  )
                                }
                              />
                            </FormControl>
                            <FormDescription>
                              {t('0 = unlimited')}
                            </FormDescription>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                  ) : null}
                </SideDrawerSection>

                <SideDrawerSection>
                  <SideDrawerSectionHeader title={t('Entry requirement')} />
                  <FormField
                    control={form.control}
                    name='min_spend'
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t('Minimum spending')}</FormLabel>
                        <FormControl>
                          <Input
                            type='number'
                            min={0}
                            step={0.01}
                            value={field.value}
                            name={field.name}
                            ref={field.ref}
                            onBlur={field.onBlur}
                            onChange={(event) => {
                              const parsed = Number.parseFloat(
                                event.target.value
                              )
                              field.onChange(
                                Number.isFinite(parsed)
                                  ? Math.max(parsed, 0)
                                  : 0
                              )
                            }}
                          />
                        </FormControl>
                        <FormDescription>
                          {t(
                            'Money paid in successful orders, subscription purchases included. 0 = no requirement.'
                          )}
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  {minSpend > 0 ? (
                    <div className='grid gap-3 sm:grid-cols-2'>
                      <FormField
                        control={form.control}
                        name='spend_start_time'
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>{t('Spending counted from')}</FormLabel>
                            <FormControl>
                              <DateTimePicker
                                value={field.value}
                                onChange={field.onChange}
                                placeholder={t('No start limit')}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name='spend_end_time'
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>{t('Spending counted until')}</FormLabel>
                            <FormControl>
                              <DateTimePicker
                                value={field.value}
                                onChange={field.onChange}
                                placeholder={t('No end limit')}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                  ) : null}
                </SideDrawerSection>

                <SideDrawerSection>
                  <SideDrawerSectionHeader title={t('Prizes')} />
                  <ActivityPrizesField form={form} />
                </SideDrawerSection>
              </fieldset>
            </fieldset>
          </form>
        </Form>
        <SheetFooter className={sideDrawerFooterClassName()}>
          <SheetClose render={<Button variant='outline' />}>
            {t('Close')}
          </SheetClose>
          <Button form='activity-form' type='submit' disabled={save.isPending}>
            {save.isPending ? t('Saving...') : t('Save changes')}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
