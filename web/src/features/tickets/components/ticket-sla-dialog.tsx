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
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Dialog } from '@/components/dialog'
import { ErrorState } from '@/components/error-state'
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
import { Skeleton } from '@/components/ui/skeleton'
import { handleServerError } from '@/lib/handle-server-error'
import { getServerErrorMessage } from '@/lib/server-error-message'

import { getTicketSettings, ticketKeys, updateTicketSettings } from '../api'
import {
  TICKET_PRIORITIES,
  TICKET_PRIORITY_CONFIG,
  TICKET_SLA_MAX_HOURS,
} from '../constants'
import { ticketSettingsSchema } from '../lib/ticket-form'
import type { TicketSettings } from '../types'

const formId = 'ticket-sla-form'

/**
 * Edits how many hours a ticket of each priority may wait for support before
 * it is overdue. The clock starts when the ticket starts waiting: on
 * creation, on each user reply, and on reopening.
 */
export function TicketSlaDialog(props: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const query = useQuery({
    queryKey: ticketKeys.settings,
    queryFn: ({ signal }) => getTicketSettings(signal),
    enabled: props.open,
    meta: { errorToast: false },
  })
  // `values` keeps the form in step with the saved targets once they load.
  const form = useForm<TicketSettings>({
    resolver: zodResolver(ticketSettingsSchema),
    values: query.data,
  })
  const save = useMutation({
    mutationFn: updateTicketSettings,
    meta: { errorToast: false },
    onSuccess: async () => {
      toast.success(t('Response targets saved'))
      props.onOpenChange(false)
      await queryClient.invalidateQueries({ queryKey: ticketKeys.all })
    },
    onError: (err) => handleServerError(err),
  })

  return (
    <Dialog
      open={props.open}
      onOpenChange={(open) => {
        if (!save.isPending) props.onOpenChange(open)
      }}
      title={t('Response targets')}
      description={t(
        'How long a ticket may wait for support before it is overdue. The clock restarts whenever the user replies or the ticket is reopened.'
      )}
      footer={
        <>
          <Button
            variant='outline'
            disabled={save.isPending}
            onClick={() => props.onOpenChange(false)}
          >
            {t('Cancel')}
          </Button>
          <Button
            type='submit'
            form={formId}
            disabled={!query.isSuccess || save.isPending}
          >
            {save.isPending ? t('Saving...') : t('Save')}
          </Button>
        </>
      }
    >
      {query.isPending && <Skeleton className='h-48 w-full' />}
      {query.isError && (
        <ErrorState
          description={getServerErrorMessage(query.error)}
          onRetry={() => void query.refetch()}
        />
      )}
      {query.isSuccess && (
        <Form {...form}>
          {/* Zod checks the hours, so the message is translated instead of
              the browser's own range bubble. */}
          <form
            id={formId}
            noValidate
            className='grid gap-4 sm:grid-cols-2'
            onSubmit={form.handleSubmit((values) => save.mutate(values))}
          >
            {TICKET_PRIORITIES.map((priority) => (
              <FormField
                key={priority}
                control={form.control}
                name={TICKET_PRIORITY_CONFIG[priority].slaKey}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      {t(TICKET_PRIORITY_CONFIG[priority].labelKey)}
                    </FormLabel>
                    <div className='flex items-center gap-2'>
                      <FormControl>
                        <Input
                          type='number'
                          inputMode='numeric'
                          min={1}
                          max={TICKET_SLA_MAX_HOURS}
                          step={1}
                          className='w-28'
                          name={field.name}
                          ref={field.ref}
                          // Never undefined: Base UI's input decides on its
                          // first render whether it is controlled.
                          value={
                            Number.isFinite(field.value) ? field.value : ''
                          }
                          onBlur={field.onBlur}
                          onChange={(event) =>
                            field.onChange(event.target.valueAsNumber)
                          }
                        />
                      </FormControl>
                      <span className='text-muted-foreground text-sm'>
                        {t('hours')}
                      </span>
                    </div>
                    <FormMessage />
                  </FormItem>
                )}
              />
            ))}
          </form>
        </Form>
      )}
    </Dialog>
  )
}
