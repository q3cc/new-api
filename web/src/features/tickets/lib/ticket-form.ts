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
import z from 'zod'

import {
  TICKET_CATEGORIES,
  TICKET_CONTENT_MAX_LENGTH,
  TICKET_IMAGE_TYPES,
  TICKET_MAX_IMAGE_BYTES,
  TICKET_MAX_IMAGES,
  TICKET_TITLE_MAX_LENGTH,
} from '../constants'

/** Messages are i18n keys; the form renders them with t(). */
export const ticketMessageSchema = z
  .string()
  .trim()
  .min(1, 'Message content is required')
  .max(TICKET_CONTENT_MAX_LENGTH, 'Message must be at most 5000 characters')

export const createTicketSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1, 'Title is required')
    .max(TICKET_TITLE_MAX_LENGTH, 'Title must be at most 128 characters'),
  category: z.enum(TICKET_CATEGORIES, 'Choose a category'),
  content: ticketMessageSchema,
  topup_trade_no: z.string().trim().max(255),
  request_id: z
    .string()
    .trim()
    .max(64, 'Invalid request ID')
    .regex(/^[A-Za-z0-9_.:-]*$/, 'Invalid request ID'),
})

export type CreateTicketValues = z.infer<typeof createTicketSchema>

/**
 * Checks images picked for a ticket message the way the server will, and
 * returns the i18n key of the first problem, or null when they can be sent.
 * The server still decides the type from the bytes.
 */
export function validateTicketImages(images: File[]): string | null {
  if (images.length > TICKET_MAX_IMAGES) {
    return 'At most {{count}} images per message'
  }
  for (const image of images) {
    if (!TICKET_IMAGE_TYPES.includes(image.type)) {
      return 'Only PNG, JPEG, GIF and WebP images are supported'
    }
    if (image.size > TICKET_MAX_IMAGE_BYTES) {
      return 'Each image must be at most {{size}} MB'
    }
  }
  return null
}

/** Values that fill the placeholders of validateTicketImages' messages. */
export const ticketImageMessageParams = {
  count: TICKET_MAX_IMAGES,
  size: TICKET_MAX_IMAGE_BYTES / 1024 / 1024,
}
