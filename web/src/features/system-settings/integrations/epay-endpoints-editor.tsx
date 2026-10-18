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
import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import * as z from 'zod'

import { StaticDataTable } from '@/components/data-table/static/static-data-table'
import { Dialog } from '@/components/dialog'
import { Button } from '@/components/ui/button'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'

import type { EpayEndpoint } from './epay-api'

type Props = {
  endpoints: EpayEndpoint[]
  onChange: (endpoints: EpayEndpoint[]) => void
  disabled?: boolean
}

const endpointSchema = z.object({
  name: z.string().trim().min(1).max(128),
  address: z
    .string()
    .trim()
    .url('Enter a valid payment service URL')
    .max(2048)
    .refine((value) => {
      try {
        const url = new URL(value)
        return (
          ['http:', 'https:'].includes(url.protocol) &&
          !url.username &&
          !url.password &&
          !url.search &&
          !url.hash
        )
      } catch {
        return false
      }
    }, 'Enter a valid payment service URL'),
  merchant_id: z.string().trim().min(1).max(128),
  key: z.string().trim().max(4096),
  enabled: z.boolean(),
  mapi: z.boolean(),
})
type EndpointValues = z.infer<typeof endpointSchema>
const formId = 'epay-endpoint-form'

export function EpayEndpointsEditor(props: Props) {
  const { t } = useTranslation()
  const [editing, setEditing] = useState<EpayEndpoint | null>(null)
  const [open, setOpen] = useState(false)
  const form = useForm<EndpointValues>({
    resolver: zodResolver(endpointSchema),
    defaultValues: {
      name: '',
      address: '',
      merchant_id: '',
      key: '',
      enabled: true,
      mapi: false,
    },
  })
  useEffect(() => {
    form.reset({
      name: editing?.name ?? '',
      address: editing?.address ?? '',
      merchant_id: editing?.merchant_id ?? '',
      key: editing?.key ?? '',
      enabled: editing?.enabled ?? true,
      mapi: editing?.mapi ?? false,
    })
  }, [editing, open, form])

  const submit = (values: EndpointValues) => {
    if (!editing?.has_key && !values.key) {
      form.setError('key', { message: t('Epay secret key is required') })
      return
    }
    const endpoint: EpayEndpoint = {
      id: editing?.id ?? crypto.randomUUID(),
      name: values.name,
      address: values.address,
      merchant_id: values.merchant_id,
      enabled: values.enabled,
      has_key: editing?.has_key ?? false,
      mapi: values.mapi,
    }
    if (values.key) endpoint.key = values.key
    props.onChange(
      editing
        ? props.endpoints.map((item) =>
            item.id === editing.id ? endpoint : item
          )
        : [...props.endpoints, endpoint]
    )
    setOpen(false)
  }

  return (
    <div className='space-y-4'>
      <div className='flex items-center justify-between gap-3'>
        <h3 className='font-medium'>{t('Payment services')}</h3>
        <Button
          type='button'
          variant='outline'
          disabled={props.disabled}
          onClick={() => {
            setEditing(null)
            setOpen(true)
          }}
        >
          {t('Add payment service')}
        </Button>
      </div>
      <StaticDataTable
        data={props.endpoints}
        getRowKey={(endpoint) => endpoint.id}
        emptyContent={t('No payment services configured')}
        columns={[
          { id: 'name', header: t('Name'), cell: (endpoint) => endpoint.name },
          {
            id: 'address',
            header: t('Epay endpoint'),
            cell: (endpoint) => (
              <span className='break-all'>{endpoint.address}</span>
            ),
          },
          {
            id: 'merchant',
            header: t('Epay merchant ID'),
            cell: (endpoint) => endpoint.merchant_id,
          },
          {
            id: 'mapi',
            header: t('Payment code'),
            cell: (endpoint) =>
              endpoint.mapi ? t('In console') : t('Gateway page'),
          },
          {
            id: 'enabled',
            header: t('Enabled'),
            cell: (endpoint) => (
              <Switch
                aria-label={t('Enable payment service {{name}}', {
                  name: endpoint.name,
                })}
                checked={endpoint.enabled}
                disabled={props.disabled}
                onCheckedChange={(enabled) =>
                  props.onChange(
                    props.endpoints.map((item) =>
                      item.id === endpoint.id ? { ...item, enabled } : item
                    )
                  )
                }
              />
            ),
          },
          {
            id: 'actions',
            header: t('Actions'),
            cell: (endpoint) => (
              <Button
                type='button'
                variant='ghost'
                disabled={props.disabled}
                onClick={() => {
                  setEditing(endpoint)
                  setOpen(true)
                }}
              >
                {t('Edit')}
              </Button>
            ),
          },
        ]}
      />
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title={editing ? t('Edit payment service') : t('Add payment service')}
        contentHeight='auto'
        footer={
          <Button type='submit' form={formId}>
            {t('Apply')}
          </Button>
        }
      >
        <Form {...form}>
          <form
            id={formId}
            className='space-y-4'
            onSubmit={(event) => {
              event.stopPropagation()
              void form.handleSubmit(submit)(event)
            }}
          >
            <FormField
              control={form.control}
              name='name'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Name')}</FormLabel>
                  <FormControl>
                    <Input {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name='address'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Epay endpoint')}</FormLabel>
                  <FormControl>
                    <Input placeholder='https://pay.example.com' {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name='merchant_id'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Epay merchant ID')}</FormLabel>
                  <FormControl>
                    <Input autoComplete='off' {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name='key'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Epay secret key')}</FormLabel>
                  <FormControl>
                    <Input
                      type='password'
                      autoComplete='new-password'
                      placeholder={
                        editing?.has_key ? t('Enter new key to update') : ''
                      }
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name='enabled'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Enabled')}</FormLabel>
                  <FormControl>
                    <Switch
                      checked={field.value}
                      onCheckedChange={field.onChange}
                    />
                  </FormControl>
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name='mapi'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    {t('Show the payment code in the console')}
                  </FormLabel>
                  <FormControl>
                    <Switch
                      checked={field.value}
                      onCheckedChange={field.onChange}
                    />
                  </FormControl>
                  <p className='text-muted-foreground text-xs'>
                    {t(
                      'Ask the gateway for a payment code and render it here, instead of opening the gateway checkout page. Requires the gateway to enable mapi.'
                    )}
                  </p>
                </FormItem>
              )}
            />
          </form>
        </Form>
      </Dialog>
    </div>
  )
}
