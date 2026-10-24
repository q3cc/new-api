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
import { expect, it } from 'vitest'

import {
  PLAN_FORM_DEFAULTS,
  formValuesToPlanPayload,
  planToFormValues,
} from '../lib/plan-form'
import { subscriptionPlanSchema } from '../types'

const plan = subscriptionPlanSchema.parse({
  id: 1,
  title: 'VIP',
  price_amount: 10,
  duration_unit: 'month',
  duration_value: 1,
  quota_reset_period: 'never',
  enabled: true,
  sort_order: 0,
  max_purchase_per_user: 0,
  total_amount: 0,
  allowed_groups: ['vip', 'svip'],
})

it('keeps the allowed groups when a plan is edited and saved', () => {
  const values = planToFormValues(plan)

  expect(values.allowed_groups).toEqual(['vip', 'svip'])
  expect(formValuesToPlanPayload(values).plan.allowed_groups).toEqual([
    'vip',
    'svip',
  ])
})

it('treats a plan without allowed groups as paying for every group', () => {
  const legacy = subscriptionPlanSchema.parse({ ...plan, allowed_groups: null })

  expect(planToFormValues(legacy).allowed_groups).toEqual([])
  expect(PLAN_FORM_DEFAULTS.allowed_groups).toEqual([])
  expect(
    formValuesToPlanPayload(PLAN_FORM_DEFAULTS).plan.allowed_groups
  ).toEqual([])
})
