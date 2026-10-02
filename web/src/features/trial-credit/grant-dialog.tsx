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
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useRef } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { z } from 'zod'

import { DateTimePicker } from '@/components/datetime-picker'
import { Dialog } from '@/components/dialog'
import { Button } from '@/components/ui/button'
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

import { grantTrialCredit } from './api'

const schema = z.object({
  amount: z.number().positive().finite(),
  expires: z.date().optional(),
})
type Values = z.infer<typeof schema>
export function TrialGrantDialog(props: {
  userId: number
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useTranslation()
  const client = useQueryClient()
  const key = useRef(crypto.randomUUID())
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { amount: 0 },
  })
  const mutation = useMutation({
    mutationFn: async (values: Values) => {
      if (values.expires && values.expires.getTime() <= Date.now()) {
        throw new Error(t('Invalid expiration time'))
      }
      await grantTrialCredit(props.userId, {
        quota: parseQuotaFromDollars(values.amount),
        expires_at: values.expires
          ? Math.floor(values.expires.getTime() / 1000)
          : 0,
        request_id: key.current,
      })
    },
    onSuccess: () => {
      key.current = crypto.randomUUID()
      form.reset()
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
