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
import i18next from 'i18next'
import { describe, expect, it } from 'vitest'

import {
  ACTIVITY_FORM_DEFAULT_VALUES,
  activityFormToPayload,
  getActivityFormSchema,
  type ActivityFormValues,
} from '../lib/activity-form'

const schema = getActivityFormSchema(i18next.t)

function values(overrides: Partial<ActivityFormValues>): ActivityFormValues {
  return {
    ...ACTIVITY_FORM_DEFAULT_VALUES,
    title: 'Spring',
    prizes: [{ ...ACTIVITY_FORM_DEFAULT_VALUES.prizes[0], name: 'Credit' }],
    ...overrides,
  }
}

function issueMessages(input: ActivityFormValues): string[] {
  const result = schema.safeParse(input)
  return result.success ? [] : result.error.issues.map((issue) => issue.message)
}

describe('activity form schema', () => {
  it('accepts the default wheel once it has a title and prize name', () => {
    expect(issueMessages(values({}))).toEqual([])
  })

  it.each([
    {
      name: 'wheel probabilities above 100%',
      input: values({
        prizes: [
          {
            ...ACTIVITY_FORM_DEFAULT_VALUES.prizes[0],
            probability_percent: 60,
          },
          {
            ...ACTIVITY_FORM_DEFAULT_VALUES.prizes[0],
            probability_percent: 41,
          },
        ],
      }),
      message: 'Prize probabilities add up to more than 100%',
    },
    {
      name: 'a scheduled draw without a draw time',
      input: values({ mode: 'scheduled' }),
      message: 'Scheduled draws need a draw time',
    },
    {
      name: 'a draw time in the past',
      input: values({ mode: 'scheduled', draw_time: new Date(1_000) }),
      message: 'Draw time must be in the future',
    },
    {
      name: 'an end time in the past',
      input: values({ end_time: new Date(1_000) }),
      message: 'End time must be in the future',
    },
    {
      name: 'a participant draw without a target',
      input: values({ mode: 'participants', target_participants: 0 }),
      message: 'Participant-count draws need a participant target',
    },
    {
      name: 'a subscription prize without a plan',
      input: values({
        prizes: [
          { ...ACTIVITY_FORM_DEFAULT_VALUES.prizes[0], type: 'subscription' },
        ],
      }),
      message: 'Please select an enabled subscription plan',
    },
    {
      name: 'a drawn prize without winners',
      input: values({
        mode: 'participants',
        target_participants: 5,
        prizes: [{ ...ACTIVITY_FORM_DEFAULT_VALUES.prizes[0], quantity: 0 }],
      }),
      message: 'Drawn prizes need at least one winner',
    },
    {
      name: 'a prize without a name',
      input: values({
        prizes: [{ ...ACTIVITY_FORM_DEFAULT_VALUES.prizes[0] }],
      }),
      message: 'Prize name is required',
    },
    {
      name: 'an invitation window ending before it starts',
      input: values({
        min_invites: 2,
        invite_start_time: new Date(2_000_000),
        invite_end_time: new Date(1_000_000),
      }),
      message: 'Invitation window end must be later than its start',
    },
    {
      name: 'more required invitations than the server accepts',
      input: values({ min_invites: 100_001 }),
      message: 'Invalid minimum invitations',
    },
    {
      name: 'no prizes',
      input: values({ prizes: [] }),
      message: 'An activity needs 1 to 20 prizes',
    },
  ])('rejects $name', ({ input, message }) => {
    expect(issueMessages(input)).toContain(message)
  })
})

describe('activityFormToPayload', () => {
  it('stores wheel probabilities in basis points and clears draw fields', () => {
    const payload = activityFormToPayload(
      values({
        target_participants: 9,
        draw_time: new Date(5_000_000),
        prizes: [
          {
            name: ' Mug ',
            type: 'manual',
            quota_amount: 3,
            plan_id: 4,
            quantity: 2,
            probability_percent: 12.5,
          },
        ],
      })
    )
    expect(payload.draw_time).toBe(0)
    expect(payload.target_participants).toBe(0)
    expect(payload.prizes[0]).toEqual({
      name: 'Mug',
      type: 'manual',
      quota: 0,
      plan_id: 0,
      quantity: 2,
      probability: 1250,
    })
  })

  it('drops the spending window when there is no spending requirement', () => {
    const payload = activityFormToPayload(
      values({
        min_spend: 0,
        spend_start_time: new Date(1_000_000),
        spend_end_time: new Date(2_000_000),
      })
    )
    expect(payload.spend_start_time).toBe(0)
    expect(payload.spend_end_time).toBe(0)
  })

  it('sends the invitation requirement with its window in seconds', () => {
    const payload = activityFormToPayload(
      values({
        min_invites: 3,
        invite_start_time: new Date(1_000_000),
        invite_end_time: new Date(2_000_000),
      })
    )
    expect(payload.min_invites).toBe(3)
    expect(payload.invite_start_time).toBe(1000)
    expect(payload.invite_end_time).toBe(2000)
  })

  it('drops the invitation window when there is no invitation requirement', () => {
    const payload = activityFormToPayload(
      values({
        min_invites: 0,
        invite_start_time: new Date(1_000_000),
        invite_end_time: new Date(2_000_000),
      })
    )
    expect(payload.min_invites).toBe(0)
    expect(payload.invite_start_time).toBe(0)
    expect(payload.invite_end_time).toBe(0)
  })

  it('keeps the draw time and drops wheel limits for scheduled draws', () => {
    const payload = activityFormToPayload(
      values({
        mode: 'scheduled',
        draw_time: new Date(5_000_000),
        wheel_total_limit: 3,
      })
    )
    expect(payload.draw_time).toBe(5000)
    expect(payload.wheel_total_limit).toBe(0)
    expect(payload.prizes[0].probability).toBe(0)
  })
})
