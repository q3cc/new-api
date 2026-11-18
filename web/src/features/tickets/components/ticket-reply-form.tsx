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
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowRight, Paperclip } from 'lucide-react'
import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import {
  PromptInput,
  PromptInputAttachment,
  PromptInputAttachments,
  PromptInputButton,
  PromptInputHeader,
  PromptInputSubmit,
  PromptInputTextarea,
  usePromptInputAttachments,
  type PromptInputMessage,
} from '@/components/ai-elements/prompt-input'
import { handleServerError } from '@/lib/handle-server-error'

import { replyTicket, ticketKeys } from '../api'
import {
  TICKET_CONTENT_MAX_LENGTH,
  TICKET_IMAGE_TYPES,
  TICKET_MAX_IMAGE_BYTES,
  TICKET_MAX_IMAGES,
} from '../constants'
import {
  ticketImageMessageParams,
  ticketMessageSchema,
  validateTicketImages,
} from '../lib/ticket-form'
import type { TicketReply, TicketViewer } from '../types'

/**
 * The chat-style composer under a ticket: the text with the attach and send
 * buttons on one line, picked or pasted screenshots above it. Enter sends,
 * Shift+Enter starts a new line. The text and images stay when sending fails.
 */
export function TicketReplyForm(props: {
  viewer: TicketViewer
  ticketId: number
}) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const errorId = useId()
  const [content, setContent] = useState('')
  const [error, setError] = useState<string | null>(null)
  const reply = useMutation({
    mutationFn: (message: TicketReply) =>
      replyTicket(props.viewer, props.ticketId, message),
    meta: { errorToast: false },
    onSuccess: async () => {
      setContent('')
      await queryClient.invalidateQueries({ queryKey: ticketKeys.all })
    },
    onError: (err) => handleServerError(err),
  })

  // A rejected promise tells PromptInput to keep the attachments.
  const send = async (message: PromptInputMessage) => {
    const parsed = ticketMessageSchema.safeParse(content)
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? null)
      throw new Error('invalid reply')
    }
    // PromptInput hands over each image as a data URL; the server wants the
    // bytes as multipart files.
    const images = (message.files ?? []).map((part) => {
      const base64 = part.url.slice(part.url.indexOf(',') + 1)
      const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))
      return new File([bytes], part.filename || 'image', {
        type: part.mediaType,
      })
    })
    const problem = validateTicketImages(images)
    if (problem) {
      setError(problem)
      throw new Error('invalid images')
    }
    setError(null)
    await reply.mutateAsync({ content: parsed.data, images })
  }

  return (
    <div className='space-y-1.5'>
      <PromptInput
        accept={TICKET_IMAGE_TYPES.join(',')}
        multiple
        maxFiles={TICKET_MAX_IMAGES}
        maxFileSize={TICKET_MAX_IMAGE_BYTES}
        onError={(err) => toast.error(err.message)}
        onSubmit={send}
        groupClassName='h-auto rounded-xl'
      >
        <TicketComposerAttachments />
        <div className='flex w-full items-end'>
          <PromptInputTextarea
            aria-label={t('Reply')}
            className='min-h-11 px-3.5 py-3'
            value={content}
            maxLength={TICKET_CONTENT_MAX_LENGTH}
            disabled={reply.isPending}
            placeholder={t('Describe the problem or add details')}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? errorId : undefined}
            onChange={(event) => {
              setContent(event.target.value)
              if (error) setError(null)
            }}
          />
          <TicketComposerActions pending={reply.isPending} />
        </div>
      </PromptInput>
      {error ? (
        <p id={errorId} role='alert' className='text-destructive text-sm'>
          {t(error, ticketImageMessageParams)}
        </p>
      ) : (
        <p className='text-muted-foreground text-xs'>
          {t(
            'Enter to send, Shift + Enter for a new line. Paste, drop or attach up to {{count}} images of {{size}} MB each.',
            ticketImageMessageParams
          )}
        </p>
      )}
    </div>
  )
}

/** The picked images above the text, shown only once there are some. */
function TicketComposerAttachments() {
  const attachments = usePromptInputAttachments()
  if (attachments.files.length === 0) return null
  return (
    <PromptInputHeader className='px-3 pt-2.5'>
      <PromptInputAttachments>
        {(file) => <PromptInputAttachment data={file} />}
      </PromptInputAttachments>
    </PromptInputHeader>
  )
}

/** The attach and send buttons at the end of the text line. */
function TicketComposerActions(props: { pending: boolean }) {
  const { t } = useTranslation()
  const attachments = usePromptInputAttachments()
  return (
    <div className='flex shrink-0 items-center gap-0.5 p-1.5'>
      <PromptInputButton
        aria-label={t('Attach images')}
        disabled={
          props.pending || attachments.files.length >= TICKET_MAX_IMAGES
        }
        onClick={attachments.openFileDialog}
      >
        <Paperclip className='size-4' aria-hidden='true' />
      </PromptInputButton>
      <PromptInputSubmit
        aria-label={t('Send reply')}
        variant='ghost'
        disabled={props.pending}
        status={props.pending ? 'submitted' : undefined}
      >
        {props.pending ? undefined : (
          <ArrowRight className='size-4' aria-hidden='true' />
        )}
      </PromptInputSubmit>
    </div>
  )
}
