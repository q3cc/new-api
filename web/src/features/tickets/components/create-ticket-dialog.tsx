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
import { useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Dialog } from '@/components/dialog'
import { Button } from '@/components/ui/button'
import { Combobox } from '@/components/ui/combobox'
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
import { Textarea } from '@/components/ui/textarea'
import { getUserBillingHistory } from '@/features/wallet/api'
import { formatTimestampToDate } from '@/lib/format'
import { handleServerError } from '@/lib/handle-server-error'

import { createTicket, ticketKeys } from '../api'
import {
  TICKET_CATEGORIES,
  TICKET_CATEGORY_LABEL_KEYS,
  TICKET_CONTENT_MAX_LENGTH,
  TICKET_TITLE_MAX_LENGTH,
} from '../constants'
import { createTicketSchema, type CreateTicketValues } from '../lib/ticket-form'
import { TicketImagePicker } from './ticket-image-picker'

const formId = 'create-ticket-form'

export function CreateTicketDialog(props: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [images, setImages] = useState<File[]>([])
  const form = useForm<CreateTicketValues>({
    resolver: zodResolver(createTicketSchema),
    defaultValues: {
      title: '',
      category: 'other',
      content: '',
      topup_trade_no: '',
      request_id: '',
    },
  })
  // The user's recent top-ups, to pick the order the ticket is about.
  const orders = useQuery({
    queryKey: ['tickets', 'user', 'orders'],
    queryFn: async () => (await getUserBillingHistory(1, 20)).data?.items ?? [],
    enabled: props.open,
    meta: { errorToast: false },
  })
  const create = useMutation({
    mutationFn: (values: CreateTicketValues) =>
      createTicket({ ...values, images }),
    meta: { errorToast: false },
    onSuccess: async (ticket) => {
      toast.success(t('Ticket submitted'))
      form.reset()
      setImages([])
      props.onOpenChange(false)
      await queryClient.invalidateQueries({ queryKey: ticketKeys.all })
      await navigate({
        to: '/tickets/$ticketId',
        params: { ticketId: String(ticket.id) },
      })
    },
    onError: (err) => handleServerError(err),
  })
  const orderOptions = (orders.data ?? [])
    .filter((order) => order.order_type !== 'subscription')
    .map((order) => ({
      value: order.trade_no,
      label: order.trade_no,
      description: formatTimestampToDate(order.create_time),
    }))

  return (
    <Dialog
      open={props.open}
      onOpenChange={(open) => {
        if (!create.isPending) props.onOpenChange(open)
      }}
      title={t('New ticket')}
      description={t(
        'Describe the problem; support replies here and notifies you.'
      )}
      contentClassName='sm:max-w-2xl'
      footer={
        <>
          <Button
            variant='outline'
            disabled={create.isPending}
            onClick={() => props.onOpenChange(false)}
          >
            {t('Cancel')}
          </Button>
          <Button type='submit' form={formId} disabled={create.isPending}>
            {create.isPending ? t('Submitting...') : t('Submit')}
          </Button>
        </>
      }
    >
      <Form {...form}>
        {/* The fieldset only disables the fields; with display: contents its
            children are the grid items, so the gap spaces every field. */}
        <form
          id={formId}
          className='grid gap-5'
          onSubmit={form.handleSubmit((values) => create.mutate(values))}
        >
          <fieldset disabled={create.isPending} className='contents'>
            <FormField
              control={form.control}
              name='title'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Title')}</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      maxLength={TICKET_TITLE_MAX_LENGTH}
                      placeholder={t('Summarize the problem in one line')}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name='category'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Category')}</FormLabel>
                  <FormControl>
                    <Combobox
                      aria-label={t('Category')}
                      options={TICKET_CATEGORIES.map((category) => ({
                        value: category as string,
                        label: t(TICKET_CATEGORY_LABEL_KEYS[category]),
                      }))}
                      value={field.value}
                      onValueChange={(value: string | null) => {
                        if (value) field.onChange(value)
                      }}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name='content'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Problem description')}</FormLabel>
                  <FormControl>
                    <Textarea
                      {...field}
                      rows={6}
                      maxLength={TICKET_CONTENT_MAX_LENGTH}
                      placeholder={t(
                        'What happened, what you expected, and when it started'
                      )}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className='grid items-start gap-5 sm:grid-cols-2 sm:gap-4'>
              <FormField
                control={form.control}
                name='topup_trade_no'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('Related order')}</FormLabel>
                    <FormControl>
                      <Combobox
                        aria-label={t('Related order')}
                        options={orderOptions}
                        value={field.value || null}
                        onValueChange={(value) => field.onChange(value ?? '')}
                        placeholder={t('No related order')}
                        emptyText={t('No top-up orders')}
                      />
                    </FormControl>
                    <FormDescription>
                      {t('Optional, for top-up and billing problems')}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name='request_id'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('Request ID')}</FormLabel>
                    <FormControl>
                      <Input {...field} maxLength={64} className='font-mono' />
                    </FormControl>
                    <FormDescription>
                      {t('Optional, copy it from the usage log of the call')}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <TicketImagePicker
              images={images}
              onChange={setImages}
              disabled={create.isPending}
            />
          </fieldset>
        </form>
      </Form>
    </Dialog>
  )
}
