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
import { ImageIcon, Paperclip, X } from 'lucide-react'
import { useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { toIntlLocale } from '@/i18n/languages'
import { formatBytes } from '@/lib/format'

import { TICKET_IMAGE_TYPES, TICKET_MAX_IMAGES } from '../constants'
import {
  ticketImageMessageParams,
  validateTicketImages,
} from '../lib/ticket-form'

/** Identifies a picked file, so the same file is listed once. */
function imageKey(file: File) {
  return `${file.name}:${file.size}:${file.lastModified}`
}

/**
 * Picks up to TICKET_MAX_IMAGES screenshots for a ticket. A button in the
 * console's language opens the file dialog instead of the browser's own file
 * control; files that would break the limits are refused with a message and
 * never added.
 */
export function TicketImagePicker(props: {
  images: File[]
  onChange: (images: File[]) => void
  disabled?: boolean
}) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const inputRef = useRef<HTMLInputElement>(null)
  const labelId = useId()
  const hintId = useId()
  const errorId = useId()
  const [error, setError] = useState<string | null>(null)
  const full = props.images.length >= TICKET_MAX_IMAGES

  return (
    <div role='group' aria-labelledby={labelId} className='grid gap-2'>
      <div className='grid gap-1'>
        <span id={labelId} className='text-sm leading-none font-medium'>
          {t('Screenshots')}
        </span>
        <p id={hintId} className='text-muted-foreground text-sm'>
          {t(
            'Optional, up to {{count}} PNG, JPEG, GIF or WebP images of {{size}} MB each',
            ticketImageMessageParams
          )}
        </p>
      </div>
      <div className='flex items-center gap-3'>
        <Button
          type='button'
          variant='outline'
          size='sm'
          disabled={props.disabled || full}
          aria-describedby={error ? `${hintId} ${errorId}` : hintId}
          onClick={() => inputRef.current?.click()}
        >
          <Paperclip className='size-4' aria-hidden='true' />
          {t('Attach images')}
        </Button>
        <span className='text-muted-foreground text-sm tabular-nums'>
          {t('{{count}} / {{max}} selected', {
            count: props.images.length,
            max: TICKET_MAX_IMAGES,
          })}
        </span>
        <input
          ref={inputRef}
          type='file'
          multiple
          hidden
          aria-label={t('Attach images')}
          accept={TICKET_IMAGE_TYPES.join(',')}
          onChange={(event) => {
            // Picking the same file again does not add it twice.
            const next = [...props.images]
            for (const file of event.target.files ?? []) {
              if (!next.some((image) => imageKey(image) === imageKey(file))) {
                next.push(file)
              }
            }
            event.target.value = ''
            const problem = validateTicketImages(next)
            setError(problem)
            if (!problem) props.onChange(next)
          }}
        />
      </div>
      {error && (
        <p id={errorId} role='alert' className='text-destructive text-sm'>
          {t(error, ticketImageMessageParams)}
        </p>
      )}
      {props.images.length > 0 && (
        <ul className='grid gap-1.5'>
          {props.images.map((image) => (
            <li
              key={imageKey(image)}
              className='flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-sm'
            >
              <ImageIcon
                className='text-muted-foreground size-4 shrink-0'
                aria-hidden='true'
              />
              <span className='min-w-0 flex-1 truncate'>{image.name}</span>
              <span className='text-muted-foreground shrink-0 text-xs tabular-nums'>
                {formatBytes(image.size, locale)}
              </span>
              <Button
                type='button'
                variant='ghost'
                size='icon'
                className='size-7'
                disabled={props.disabled}
                aria-label={t('Remove {{name}}', { name: image.name })}
                onClick={() => {
                  setError(null)
                  props.onChange(
                    props.images.filter((other) => other !== image)
                  )
                }}
              >
                <X className='size-4' aria-hidden='true' />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
