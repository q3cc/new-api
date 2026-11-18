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
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowRight, MessageSquareText, Paperclip } from 'lucide-react'
import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import {
  PromptInput,
  PromptInputActionMenu,
  PromptInputActionMenuContent,
  PromptInputActionMenuItem,
  PromptInputActionMenuTrigger,
  PromptInputAttachment,
  PromptInputAttachments,
  PromptInputButton,
  PromptInputHeader,
  PromptInputSubmit,
  PromptInputTextarea,
  usePromptInputAttachments,
  type PromptInputMessage,
} from '@/components/ai-elements/prompt-input'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { handleServerError } from '@/lib/handle-server-error'
import { cn } from '@/lib/utils'

import { getTicketCannedReplies, replyTicket, ticketKeys } from '../api'
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
import type { TicketCannedReply, TicketReply, TicketViewer } from '../types'

/**
 * The chat-style composer under a ticket: the text with the attach and send
 * buttons on one line, picked or pasted screenshots above it. Enter sends,
 * Shift+Enter starts a new line. The text and images stay when sending fails.
 * Support may switch it to an internal note and insert canned replies.
 */
export function TicketReplyForm(props: {
  viewer: TicketViewer
  ticketId: number
  /** A closed ticket takes notes only. */
  notesOnly?: boolean
}) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const errorId = useId()
  const staff = props.viewer === 'staff'
  const [content, setContent] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [mode, setMode] = useState<'reply' | 'note'>('reply')
  const internal = staff && (mode === 'note' || props.notesOnly === true)
  const cannedReplies = useQuery({
    queryKey: ticketKeys.cannedReplies,
    queryFn: ({ signal }) => getTicketCannedReplies(signal),
    enabled: staff,
    meta: { errorToast: false },
  })
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
    await reply.mutateAsync({ content: parsed.data, images, internal })
  }

  return (
    <div className='space-y-1.5'>
      {staff && !props.notesOnly && (
        <ToggleGroup
          value={[mode]}
          onValueChange={(values) => {
            const next = values.find((value) => value !== mode)
            if (next === 'reply' || next === 'note') setMode(next)
          }}
          aria-label={t('Message type')}
          variant='outline'
          size='sm'
          spacing={1}
        >
          <ToggleGroupItem value='reply'>{t('Reply to user')}</ToggleGroupItem>
          <ToggleGroupItem value='note'>{t('Internal note')}</ToggleGroupItem>
        </ToggleGroup>
      )}
      <PromptInput
        accept={TICKET_IMAGE_TYPES.join(',')}
        multiple
        maxFiles={TICKET_MAX_IMAGES}
        maxFileSize={TICKET_MAX_IMAGE_BYTES}
        onError={(err) => toast.error(err.message)}
        onSubmit={send}
        groupClassName={cn(
          'h-auto rounded-xl',
          internal && 'border-warning/60 bg-warning/5'
        )}
      >
        <TicketComposerAttachments />
        <div className='flex w-full items-end'>
          <PromptInputTextarea
            aria-label={internal ? t('Internal note') : t('Reply')}
            className='min-h-11 px-3.5 py-3'
            value={content}
            maxLength={TICKET_CONTENT_MAX_LENGTH}
            disabled={reply.isPending}
            placeholder={
              internal
                ? t('Only support can see this note')
                : t('Describe the problem or add details')
            }
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? errorId : undefined}
            onChange={(event) => {
              setContent(event.target.value)
              if (error) setError(null)
            }}
          />
          <TicketComposerActions
            pending={reply.isPending}
            cannedReplies={staff ? (cannedReplies.data ?? []) : undefined}
            onInsert={(text) => {
              setContent((current) =>
                current.trim() ? `${current}\n${text}` : text
              )
              if (error) setError(null)
            }}
          />
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

/**
 * The buttons at the end of the text line: canned replies for support,
 * attach, and send.
 */
function TicketComposerActions(props: {
  pending: boolean
  cannedReplies?: TicketCannedReply[]
  onInsert: (text: string) => void
}) {
  const { t } = useTranslation()
  const attachments = usePromptInputAttachments()
  return (
    <div className='flex shrink-0 items-center gap-0.5 p-1.5'>
      {props.cannedReplies && (
        <PromptInputActionMenu>
          <PromptInputActionMenuTrigger
            aria-label={t('Insert a canned reply')}
            disabled={props.pending}
          >
            <MessageSquareText className='size-4' aria-hidden='true' />
          </PromptInputActionMenuTrigger>
          <PromptInputActionMenuContent className='max-h-72 w-72 overflow-y-auto'>
            {props.cannedReplies.length === 0 ? (
              <p className='text-muted-foreground px-2 py-1.5 text-sm'>
                {t('No canned replies yet')}
              </p>
            ) : (
              props.cannedReplies.map((reply) => (
                <PromptInputActionMenuItem
                  key={reply.id}
                  className='flex-col items-start gap-0.5'
                  onClick={() => props.onInsert(reply.content)}
                >
                  <span className='font-medium'>{reply.title}</span>
                  <span className='text-muted-foreground line-clamp-1 text-xs'>
                    {reply.content}
                  </span>
                </PromptInputActionMenuItem>
              ))
            )}
          </PromptInputActionMenuContent>
        </PromptInputActionMenu>
      )}
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
