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
import type { UserRiskScore } from '@/features/users/types'

export type ReferralsTab = 'invites' | 'rebates' | 'logs'

export type AffiliateRebateStatus =
  | 'pending'
  | 'review'
  | 'confirmed'
  | 'rejected'

export type AffiliateInviteAction = 'cancel' | 'restore'

export type AffiliateSummary = {
  active_invites: number
  cancelled_invites: number
  pending_quota: number
  review_count: number
}

/** A current invitation: the invitee still counts as invited by the inviter. */
export type AffiliateInvite = {
  invitee_id: number
  invitee_username: string
  invitee_status: number
  created_at: number
  inviter_id: number
  inviter_username: string
  risk_score?: UserRiskScore | null
  confirmed_quota: number
  pending_quota: number
}

export type AffiliateRebate = {
  id: number
  inviter_id: number
  inviter_username: string
  invitee_id: number
  invitee_username: string
  trade_no: string
  source: 'topup' | 'subscription'
  base_quota: number
  rate_bps: number
  quota: number
  status: AffiliateRebateStatus
  confirm_at: number
  /** Message key translated by the console. */
  reason: string
  risk_score: number
  reviewed_by: number
  reviewer_username: string
  review_note: string
  confirmed_at: number
  created_at: number
}

export type AffiliateInviteLog = {
  id: number
  invitee_id: number
  invitee_username: string
  inviter_id: number
  inviter_username: string
  action: AffiliateInviteAction
  /** Message key translated by the console. */
  reason: string
  /** Comma-separated IPs both accounts were seen on. */
  shared_ips: string
  /** 0 when the system acted. */
  operator_id: number
  operator_username: string
  note: string
  created_at: number
  /** A cancellation still in effect, so an admin can restore it. */
  restorable: boolean
}

export type ReferralPage<T> = { items: T[]; total: number }
