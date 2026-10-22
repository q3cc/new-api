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
export type ApiResponse<T = unknown> = {
  success: boolean
  message?: string
  data?: T
}

export type LotteryMode = 'wheel' | 'scheduled' | 'participants'

export type LotteryStatus = 'draft' | 'active' | 'drawn' | 'cancelled'

export type LotteryPrizeType = 'manual' | 'quota' | 'subscription'

export type LotteryDeliveryStatus = 'none' | 'pending' | 'delivered' | 'failed'

export type LotteryPrize = {
  id: number
  activity_id: number
  name: string
  type: LotteryPrizeType
  quota: number
  plan_id: number
  /** Winners when drawn, or wheel stock where 0 is unlimited. */
  quantity: number
  awarded: number
  /** Wheel probability in basis points (10000 = 100%). */
  probability: number
  sort_order: number
}

export type LotteryActivity = {
  id: number
  title: string
  description: string
  mode: LotteryMode
  status: LotteryStatus
  start_time: number
  end_time: number
  draw_time: number
  target_participants: number
  min_spend: number
  spend_start_time: number
  spend_end_time: number
  wheel_total_limit: number
  wheel_daily_limit: number
  entry_count: number
  drawn_at: number
  created_at: number
  updated_at: number
  prizes: LotteryPrize[]
}

export type LotteryEntry = {
  id: number
  activity_id: number
  user_id: number
  spin_date: string
  prize_id: number
  prize_name: string
  prize_type: LotteryPrizeType | ''
  delivery_status: LotteryDeliveryStatus
  delivery_note: string
  delivered_at: number
  created_at: number
}

export type LotteryUserState = {
  paid: number
  eligible: boolean
  joined: boolean
  spins_used: number
  spins_used_today: number
  wins: LotteryEntry[]
}

/** A public win, naming the winner only by user ID. */
export type LotteryWinner = {
  user_id: number
  prize_id: number
  prize_name: string
  created_at: number
}

export type LotteryActivityView = LotteryActivity & {
  me: LotteryUserState
  /** Latest wins, newest first; capped by the server. */
  winners: LotteryWinner[]
  winner_count: number
}

export type LotteryWin = LotteryEntry & {
  activity_title: string
}

export type LotteryAdminEntry = LotteryEntry & {
  username: string
}

export type LotteryEntryPage = {
  page: number
  page_size: number
  total: number
  items: LotteryAdminEntry[]
}

export type LotteryPrizePayload = Pick<
  LotteryPrize,
  'name' | 'type' | 'quota' | 'plan_id' | 'quantity' | 'probability'
>

export type LotteryActivityPayload = Pick<
  LotteryActivity,
  | 'title'
  | 'description'
  | 'mode'
  | 'status'
  | 'start_time'
  | 'end_time'
  | 'draw_time'
  | 'target_participants'
  | 'min_spend'
  | 'spend_start_time'
  | 'spend_end_time'
  | 'wheel_total_limit'
  | 'wheel_daily_limit'
> & {
  prizes: LotteryPrizePayload[]
}
