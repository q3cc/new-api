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
/** Rebates credited to an inviter, in all and in the current period. */
export type AffiliateEarnings = {
  total_quota: number
  month_quota: number
  quarter_quota: number
  /** Invitees whose payments earned a credited rebate. */
  paying_invites: number
}

/** A ranked inviter; others are identified only by a masked username. */
export type LeaderboardRow = AffiliateEarnings & {
  rank: number
  name: string
  is_me: boolean
}

export type AffiliateLeaderboard = {
  rows: LeaderboardRow[]
  /** The caller's figures; rank is 0 when not among the listed ranks. */
  me: AffiliateEarnings & { rank: number }
}

/** A user the caller invited, current or cancelled. */
export type AffiliateInvitee = {
  invitee_id: number
  /** The username with all but its first and last character hidden. */
  name: string
  created_at: number
  cancelled: boolean
  cancelled_at: number
  /** Message key translated by the console. */
  cancel_reason: string
  confirmed_quota: number
  pending_quota: number
}

export type InviteePage = { items: AffiliateInvitee[]; total: number }

export type PromotionTab = 'invitees' | 'rebates'
