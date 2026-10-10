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
import { useRef, useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import type { z } from 'zod'

import { DateTimePicker } from '@/components/datetime-picker'
import { Dialog } from '@/components/dialog'
import { ErrorState } from '@/components/error-state'
import { LoadingState } from '@/components/loading-state'
import { Button } from '@/components/ui/button'
import { Combobox } from '@/components/ui/combobox'
import {
  Form,
  FormField,
  FormItem,
  FormLabel,
  FormControl,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { getCurrencyLabel } from '@/lib/currency'
import { parseQuotaFromDollars } from '@/lib/format'
import { handleServerError } from '@/lib/handle-server-error'

import { grantTrialCredit, getTrialTypes } from './api'
import { trialGrantSchema } from './lib/schema'

type Values = z.infer<typeof trialGrantSchema>
export function TrialGrantDialog(props: {
  userId: number
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useTranslation()
  const client = useQueryClient()
  const key = useRef(crypto.randomUUID())
  const form = useForm<Values>({
    resolver: zodResolver(trialGrantSchema),
    defaultValues: { amount: 0, type_id: 0 },
  })
  const kinds = useQuery({
    queryKey: ['trial-types'],
    queryFn: getTrialTypes,
    enabled: props.open,
  })
  useEffect(() => {
    if (kinds.data?.length === 1 && !form.getValues('type_id')) {
      form.setValue('type_id', kinds.data[0].id)
    }
  }, [kinds.data, form])
  const mutation = useMutation({
    mutationFn: async (values: Values) => {
      if (values.expires && values.expires.getTime() <= Date.now()) {
        throw new Error(t('Invalid expiration time'))
      }
      await grantTrialCredit(props.userId, {
        type_id: values.type_id,
        quota: parseQuotaFromDollars(values.amount),
        expires_at: values.expires
          ? Math.floor(values.expires.getTime() / 1000)
          : 0,
        request_id: key.current,
      })
    },
    onSuccess: () => {
      key.current = crypto.randomUUID()
      form.reset({
        amount: 0,
        type_id: kinds.data?.length === 1 ? kinds.data[0].id : 0,
      })
      props.onOpenChange(false)
      void client.invalidateQueries({ queryKey: ['trial-balance'] })
    },
    onError: (error) => handleServerError(error),
  })
  return (
    <Dialog
      open={props.open}
      onOpenChange={(open) => {
        if (!mutation.isPending) props.onOpenChange(open)
      }}
      title={t('Grant trial credit')}
      contentHeight='auto'
      footer={
        <Button
          disabled={mutation.isPending}
          onClick={form.handleSubmit((v) => mutation.mutate(v))}
        >
          {t('Confirm')}
        </Button>
      }
    >
      <Form {...form}>
        <form
          className='space-y-4'
          onSubmit={form.handleSubmit((v) => mutation.mutate(v))}
        >
          {kinds.isPending && <LoadingState />}
          {kinds.isError && <ErrorState onRetry={() => void kinds.refetch()} />}
          {kinds.data?.length === 0 && (
            <p>{t('No trial credit kinds available')}</p>
          )}
          <FormField
            control={form.control}
            name='type_id'
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('Trial credit kind')}</FormLabel>
                <FormControl>
                  <Combobox
                    disabled={
                      mutation.isPending || kinds.isPending || kinds.isError
                    }
                    value={field.value ? String(field.value) : null}
                    onValueChange={(v) => field.onChange(Number(v))}
                    options={(kinds.data ?? []).map((k) => ({
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
            name='amount'
            render={({ field }) => (
              <FormItem>
                <FormLabel>
                  {t('Amount')} ({getCurrencyLabel()})
                </FormLabel>
                <FormControl>
                  <Input
                    type='number'
                    min={0}
                    step='any'
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
            name='expires'
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('Expiration time')}</FormLabel>
                <DateTimePicker
                  value={field.value}
                  onChange={field.onChange}
                  placeholder={t('Never expires')}
                />
                <FormMessage />
              </FormItem>
            )}
          />
        </form>
      </Form>
    </Dialog>
  )
}
