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
import type { StatusVariant } from '@/components/status-badge'

import type {
  TicketCategory,
  TicketPriority,
  TicketSettings,
  TicketStatus,
} from './types'

// Limits the server enforces; the form checks them first to answer sooner.
export const TICKET_TITLE_MAX_LENGTH = 128
export const TICKET_CONTENT_MAX_LENGTH = 5000
export const TICKET_MAX_IMAGES = 3
export const TICKET_MAX_IMAGE_BYTES = 2 * 1024 * 1024
export const TICKET_IMAGE_TYPES = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
]

/** Label keys are i18n keys; components render them with t(). */
export const TICKET_STATUS_CONFIG: Record<
  TicketStatus,
  { labelKey: string; variant: StatusVariant }
> = {
  open: { labelKey: 'Awaiting support', variant: 'warning' },
  replied: { labelKey: 'Replied', variant: 'info' },
  closed: { labelKey: 'Closed', variant: 'neutral' },
}

export const TICKET_STATUSES = Object.keys(
  TICKET_STATUS_CONFIG
) as TicketStatus[]

export const TICKET_CATEGORY_LABEL_KEYS: Record<TicketCategory, string> = {
  billing: 'Top-up & billing',
  api: 'API & models',
  account: 'Account & security',
  other: 'Other',
}

export const TICKET_CATEGORIES = Object.keys(
  TICKET_CATEGORY_LABEL_KEYS
) as TicketCategory[]

/** From most to least pressing; label keys are i18n keys. */
export const TICKET_PRIORITY_CONFIG: Record<
  TicketPriority,
  { labelKey: string; variant: StatusVariant; slaKey: keyof TicketSettings }
> = {
  urgent: { labelKey: 'Urgent', variant: 'danger', slaKey: 'sla_urgent_hours' },
  high: { labelKey: 'High', variant: 'warning', slaKey: 'sla_high_hours' },
  normal: { labelKey: 'Medium', variant: 'info', slaKey: 'sla_normal_hours' },
  low: { labelKey: 'Low', variant: 'neutral', slaKey: 'sla_low_hours' },
}

export const TICKET_PRIORITIES = Object.keys(
  TICKET_PRIORITY_CONFIG
) as TicketPriority[]

export const TICKET_RATING_COMMENT_MAX_LENGTH = 500
export const TICKET_SLA_MAX_HOURS = 720
export const TICKET_CANNED_TITLE_MAX_LENGTH = 64
