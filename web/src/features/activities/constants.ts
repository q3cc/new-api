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
  LotteryDeliveryStatus,
  LotteryMode,
  LotteryPrizeType,
  LotteryStatus,
} from './types'

export const LOTTERY_MODES: Record<LotteryMode, { labelKey: string }> = {
  wheel: { labelKey: 'Lucky wheel' },
  scheduled: { labelKey: 'Scheduled draw' },
  participants: { labelKey: 'Participant-count draw' },
}

export const LOTTERY_STATUSES: Record<
  LotteryStatus,
  { labelKey: string; variant: StatusVariant }
> = {
  draft: { labelKey: 'Draft', variant: 'neutral' },
  active: { labelKey: 'Active', variant: 'success' },
  drawn: { labelKey: 'Drawn', variant: 'info' },
  cancelled: { labelKey: 'Cancelled', variant: 'danger' },
}

export const LOTTERY_PRIZE_TYPES: Record<
  LotteryPrizeType,
  { labelKey: string }
> = {
  manual: { labelKey: 'Manual delivery' },
  quota: { labelKey: 'Balance' },
  subscription: { labelKey: 'Subscription plan' },
}

export const LOTTERY_DELIVERY_STATUSES: Record<
  LotteryDeliveryStatus,
  { labelKey: string; variant: StatusVariant }
> = {
  none: { labelKey: 'Not won', variant: 'neutral' },
  pending: { labelKey: 'Pending delivery', variant: 'warning' },
  delivered: { labelKey: 'Delivered', variant: 'success' },
  failed: { labelKey: 'Delivery failed', variant: 'danger' },
}

/** Wheel probabilities are stored in basis points. */
export const LOTTERY_PROBABILITY_SCALE = 10000

export const LOTTERY_MAX_PRIZES = 20

/** Upper bound the server accepts for the invitation requirement. */
export const LOTTERY_MAX_MIN_INVITES = 100_000
