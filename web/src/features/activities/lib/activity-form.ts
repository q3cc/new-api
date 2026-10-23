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
import type { TFunction } from 'i18next'
import { z } from 'zod'

import { parseQuotaFromDollars, quotaUnitsToEditableAmount } from '@/lib/format'

import {
  LOTTERY_MAX_MIN_INVITES,
  LOTTERY_MAX_PRIZES,
  LOTTERY_PROBABILITY_SCALE,
} from '../constants'
import type { LotteryActivity, LotteryActivityPayload } from '../types'

const prizeSchema = z.object({
  name: z.string(),
  type: z.enum(['manual', 'quota', 'subscription']),
  quota_amount: z.number(),
  plan_id: z.number().int().min(0),
  quantity: z.number().int().min(0),
  /** Percent, e.g. 12.5 for 12.5%. */
  probability_percent: z.number().min(0).max(100),
})

export function getActivityFormSchema(t: TFunction) {
  return z
    .object({
      title: z
        .string()
        .trim()
        .min(1, t('Activity title is required'))
        .max(128, t('Activity title must be at most 128 characters')),
      description: z.string(),
      mode: z.enum(['wheel', 'scheduled', 'participants']),
      status: z.enum(['draft', 'active']),
      start_time: z.date().optional(),
      end_time: z.date().optional(),
      draw_time: z.date().optional(),
      target_participants: z.number().int().min(0),
      min_spend: z.number().min(0),
      spend_start_time: z.date().optional(),
      spend_end_time: z.date().optional(),
      min_invites: z.number().int().min(0),
      invite_start_time: z.date().optional(),
      invite_end_time: z.date().optional(),
      wheel_total_limit: z.number().int().min(0),
      wheel_daily_limit: z.number().int().min(0),
      prizes: z.array(prizeSchema),
    })
    .superRefine((values, context) => {
      const issue = (path: (string | number)[], message: string) =>
        context.addIssue({ code: 'custom', path, message })
      if (
        values.start_time &&
        values.end_time &&
        values.end_time <= values.start_time
      ) {
        issue(['end_time'], t('End time must be later than start time'))
      }
      // A past end or draw time would close or draw the activity at once.
      const now = new Date()
      if (values.end_time && values.end_time <= now) {
        issue(['end_time'], t('End time must be in the future'))
      }
      if (values.mode === 'scheduled') {
        if (!values.draw_time) {
          issue(['draw_time'], t('Scheduled draws need a draw time'))
        } else if (values.start_time && values.draw_time <= values.start_time) {
          issue(['draw_time'], t('Draw time must be later than start time'))
        } else if (values.draw_time <= now) {
          issue(['draw_time'], t('Draw time must be in the future'))
        }
      }
      if (values.mode === 'participants' && values.target_participants < 1) {
        issue(
          ['target_participants'],
          t('Participant-count draws need a participant target')
        )
      }
      if (
        values.spend_start_time &&
        values.spend_end_time &&
        values.spend_end_time <= values.spend_start_time
      ) {
        issue(
          ['spend_end_time'],
          t('Spending window end must be later than its start')
        )
      }
      if (values.min_invites > LOTTERY_MAX_MIN_INVITES) {
        issue(['min_invites'], t('Invalid minimum invitations'))
      }
      if (
        values.invite_start_time &&
        values.invite_end_time &&
        values.invite_end_time <= values.invite_start_time
      ) {
        issue(
          ['invite_end_time'],
          t('Invitation window end must be later than its start')
        )
      }
      if (
        values.prizes.length === 0 ||
        values.prizes.length > LOTTERY_MAX_PRIZES
      ) {
        issue(['prizes'], t('An activity needs 1 to 20 prizes'))
      }
      let probability = 0
      values.prizes.forEach((prize, index) => {
        if (!prize.name.trim()) {
          issue(['prizes', index, 'name'], t('Prize name is required'))
        }
        if (prize.type === 'quota' && prize.quota_amount <= 0) {
          issue(
            ['prizes', index, 'quota_amount'],
            t('Quota must be a positive number')
          )
        }
        if (prize.type === 'subscription' && prize.plan_id <= 0) {
          issue(
            ['prizes', index, 'plan_id'],
            t('Please select an enabled subscription plan')
          )
        }
        if (values.mode !== 'wheel' && prize.quantity < 1) {
          issue(
            ['prizes', index, 'quantity'],
            t('Drawn prizes need at least one winner')
          )
        }
        probability += prize.probability_percent
      })
      if (values.mode === 'wheel' && probability > 100 + 1e-9) {
        issue(['prizes'], t('Prize probabilities add up to more than 100%'))
      }
    })
}

export type ActivityFormValues = z.infer<
  ReturnType<typeof getActivityFormSchema>
>

export type ActivityPrizeFormValues = ActivityFormValues['prizes'][number]

export const EMPTY_PRIZE: ActivityPrizeFormValues = {
  name: '',
  type: 'quota',
  quota_amount: 1,
  plan_id: 0,
  quantity: 1,
  probability_percent: 10,
}

export const ACTIVITY_FORM_DEFAULT_VALUES: ActivityFormValues = {
  title: '',
  description: '',
  mode: 'wheel',
  status: 'active',
  start_time: undefined,
  end_time: undefined,
  draw_time: undefined,
  target_participants: 10,
  min_spend: 0,
  spend_start_time: undefined,
  spend_end_time: undefined,
  min_invites: 0,
  invite_start_time: undefined,
  invite_end_time: undefined,
  wheel_total_limit: 1,
  wheel_daily_limit: 0,
  prizes: [{ ...EMPTY_PRIZE }],
}

function toSeconds(date?: Date): number {
  return date ? Math.floor(date.getTime() / 1000) : 0
}

function toDate(seconds: number): Date | undefined {
  return seconds > 0 ? new Date(seconds * 1000) : undefined
}

export function activityFormToPayload(
  values: ActivityFormValues
): LotteryActivityPayload {
  return {
    title: values.title.trim(),
    description: values.description,
    mode: values.mode,
    status: values.status,
    start_time: toSeconds(values.start_time),
    end_time: toSeconds(values.end_time),
    draw_time: values.mode === 'scheduled' ? toSeconds(values.draw_time) : 0,
    target_participants:
      values.mode === 'participants' ? values.target_participants : 0,
    min_spend: values.min_spend,
    spend_start_time:
      values.min_spend > 0 ? toSeconds(values.spend_start_time) : 0,
    spend_end_time: values.min_spend > 0 ? toSeconds(values.spend_end_time) : 0,
    min_invites: values.min_invites,
    invite_start_time:
      values.min_invites > 0 ? toSeconds(values.invite_start_time) : 0,
    invite_end_time:
      values.min_invites > 0 ? toSeconds(values.invite_end_time) : 0,
    wheel_total_limit: values.mode === 'wheel' ? values.wheel_total_limit : 0,
    wheel_daily_limit: values.mode === 'wheel' ? values.wheel_daily_limit : 0,
    prizes: values.prizes.map((prize) => ({
      name: prize.name.trim(),
      type: prize.type,
      quota:
        prize.type === 'quota' ? parseQuotaFromDollars(prize.quota_amount) : 0,
      plan_id: prize.type === 'subscription' ? prize.plan_id : 0,
      quantity: prize.quantity,
      probability:
        values.mode === 'wheel'
          ? Math.round(
              (prize.probability_percent * LOTTERY_PROBABILITY_SCALE) / 100
            )
          : 0,
    })),
  }
}

export function activityToFormValues(
  activity: LotteryActivity
): ActivityFormValues {
  return {
    title: activity.title,
    description: activity.description,
    mode: activity.mode,
    status: activity.status === 'draft' ? 'draft' : 'active',
    start_time: toDate(activity.start_time),
    end_time: toDate(activity.end_time),
    draw_time: toDate(activity.draw_time),
    target_participants: activity.target_participants || 10,
    min_spend: activity.min_spend,
    spend_start_time: toDate(activity.spend_start_time),
    spend_end_time: toDate(activity.spend_end_time),
    min_invites: activity.min_invites,
    invite_start_time: toDate(activity.invite_start_time),
    invite_end_time: toDate(activity.invite_end_time),
    wheel_total_limit: activity.wheel_total_limit,
    wheel_daily_limit: activity.wheel_daily_limit,
    prizes: activity.prizes.map((prize) => ({
      name: prize.name,
      type: prize.type,
      quota_amount:
        prize.type === 'quota' ? quotaUnitsToEditableAmount(prize.quota) : 1,
      plan_id: prize.plan_id,
      quantity: prize.quantity,
      probability_percent:
        (prize.probability * 100) / LOTTERY_PROBABILITY_SCALE,
    })),
  }
}
