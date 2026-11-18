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
import { MessageSquareText, Pencil, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { ConfirmDialog } from '@/components/confirm-dialog'
import { Dialog } from '@/components/dialog'
import { EmptyState } from '@/components/empty-state'
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
import { Textarea } from '@/components/ui/textarea'
import { handleServerError } from '@/lib/handle-server-error'
import { getServerErrorMessage } from '@/lib/server-error-message'

import {
  deleteTicketCannedReply,
  getTicketCannedReplies,
  saveTicketCannedReply,
  ticketKeys,
} from '../api'
import {
  TICKET_CANNED_TITLE_MAX_LENGTH,
  TICKET_CONTENT_MAX_LENGTH,
} from '../constants'
import { cannedReplySchema, type CannedReplyValues } from '../lib/ticket-form'
import type { TicketCannedReply } from '../types'

const formId = 'canned-reply-form'

/** Lists, adds, edits and deletes the reply texts support staff share. */
export function CannedRepliesDialog(props: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  // null lists the replies; an object edits one, without an id for a new one.
  const [editing, setEditing] = useState<{ id?: number } | null>(null)
  const [removing, setRemoving] = useState<TicketCannedReply | null>(null)
  const query = useQuery({
    queryKey: ticketKeys.cannedReplies,
    queryFn: ({ signal }) => getTicketCannedReplies(signal),
    enabled: props.open,
    meta: { errorToast: false },
  })
  const form = useForm<CannedReplyValues>({
    resolver: zodResolver(cannedReplySchema),
    defaultValues: { title: '', content: '' },
  })
  const save = useMutation({
    mutationFn: (values: CannedReplyValues) =>
      saveTicketCannedReply({ ...values, id: editing?.id }),
    meta: { errorToast: false },
    onSuccess: async () => {
      toast.success(t('Canned reply saved'))
      setEditing(null)
      await queryClient.invalidateQueries({
        queryKey: ticketKeys.cannedReplies,
      })
    },
    onError: (err) => handleServerError(err),
  })
  const remove = useMutation({
    mutationFn: (reply: TicketCannedReply) => deleteTicketCannedReply(reply.id),
    meta: { errorToast: false },
    onSuccess: async () => {
      toast.success(t('Canned reply deleted'))
      setRemoving(null)
      await queryClient.invalidateQueries({
        queryKey: ticketKeys.cannedReplies,
      })
    },
    onError: (err) => handleServerError(err),
  })
  const startEditing = (reply?: TicketCannedReply) => {
    form.reset({ title: reply?.title ?? '', content: reply?.content ?? '' })
    setEditing({ id: reply?.id })
  }

  return (
    <>
      <Dialog
        open={props.open}
        onOpenChange={(open) => {
          if (save.isPending) return
          if (!open) setEditing(null)
          props.onOpenChange(open)
        }}
        title={t('Canned replies')}
        description={t(
          'Reply texts every support member can insert into a ticket reply.'
        )}
        contentClassName='sm:max-w-2xl'
        footer={
          editing ? (
            <>
              <Button
                variant='outline'
                disabled={save.isPending}
                onClick={() => setEditing(null)}
              >
                {t('Cancel')}
              </Button>
              <Button type='submit' form={formId} disabled={save.isPending}>
                {save.isPending ? t('Saving...') : t('Save')}
              </Button>
            </>
          ) : undefined
        }
      >
        {editing ? (
          <Form {...form}>
            <form
              id={formId}
              className='grid gap-5'
              onSubmit={form.handleSubmit((values) => save.mutate(values))}
            >
              <FormField
                control={form.control}
                name='title'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('Title')}</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        maxLength={TICKET_CANNED_TITLE_MAX_LENGTH}
                        placeholder={t('For example: refund processed')}
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
                    <FormLabel>{t('Reply text')}</FormLabel>
                    <FormControl>
                      <Textarea
                        {...field}
                        rows={6}
                        maxLength={TICKET_CONTENT_MAX_LENGTH}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </form>
          </Form>
        ) : (
          <div className='grid gap-3'>
            <div>
              <Button size='sm' onClick={() => startEditing()}>
                <Plus className='size-4' aria-hidden='true' />
                {t('New canned reply')}
              </Button>
            </div>
            {query.isPending && <Skeleton className='h-32 w-full' />}
            {query.isError && (
              <ErrorState
                description={getServerErrorMessage(query.error)}
                onRetry={() => void query.refetch()}
              />
            )}
            {query.isSuccess && query.data.length === 0 && (
              <EmptyState
                icon={MessageSquareText}
                title={t('No canned replies yet')}
                className='min-h-40'
              />
            )}
            {query.isSuccess && query.data.length > 0 && (
              <ul className='grid gap-2' aria-label={t('Canned replies')}>
                {query.data.map((reply) => (
                  <li
                    key={reply.id}
                    className='flex items-start gap-3 rounded-lg border p-3'
                  >
                    <div className='min-w-0 flex-1'>
                      <p className='text-sm font-medium'>{reply.title}</p>
                      <p className='text-muted-foreground line-clamp-2 text-sm break-words whitespace-pre-wrap'>
                        {reply.content}
                      </p>
                    </div>
                    <Button
                      variant='ghost'
                      size='icon'
                      className='size-8'
                      aria-label={t('Edit {{name}}', { name: reply.title })}
                      onClick={() => startEditing(reply)}
                    >
                      <Pencil className='size-4' aria-hidden='true' />
                    </Button>
                    <Button
                      variant='ghost'
                      size='icon'
                      className='size-8'
                      aria-label={t('Delete {{name}}', { name: reply.title })}
                      onClick={() => setRemoving(reply)}
                    >
                      <Trash2 className='size-4' aria-hidden='true' />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </Dialog>
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => {
          if (!open && !remove.isPending) setRemoving(null)
        }}
        title={t('Delete canned reply')}
        desc={t('"{{name}}" will be removed for every support member.', {
          name: removing?.title ?? '',
        })}
        confirmText={t('Delete')}
        destructive
        isLoading={remove.isPending}
        handleConfirm={() => {
          if (removing) remove.mutate(removing)
        }}
      />
    </>
  )
}
