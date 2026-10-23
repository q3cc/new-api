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

import type { AffiliateInviteAction, AffiliateRebateStatus } from './types'

export const REBATE_STATUSES: Record<
  AffiliateRebateStatus,
  { labelKey: string; variant: StatusVariant }
> = {
  pending: { labelKey: 'Confirming', variant: 'info' },
  review: { labelKey: 'Under review', variant: 'warning' },
  confirmed: { labelKey: 'Credited', variant: 'success' },
  rejected: { labelKey: 'Rejected', variant: 'danger' },
}

export const INVITE_LOG_ACTIONS: Record<
  AffiliateInviteAction,
  { labelKey: string; variant: StatusVariant }
> = {
  cancel: { labelKey: 'Cancelled', variant: 'danger' },
  restore: { labelKey: 'Restored', variant: 'success' },
}
