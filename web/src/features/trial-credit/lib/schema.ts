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
import { z } from 'zod'

export const trialConfigSchema = z.object({
  enabled: z.boolean(),
  group: z.string(),
  affiliate: z.boolean(),
  affiliate_days: z.number().int().min(0).max(36500),
  affiliate_type_id: z.number().int().min(0),
  waive_threshold_usd: z
    .number()
    .min(0)
    .max(100)
    .nullish()
    .transform((value) => value ?? null),
  types: z
    .array(
      z.object({
        id: z.number().int().min(0),
        name: z.string().trim().min(1).max(128),
        group: z.string().min(1).max(64),
        enabled: z.boolean(),
      })
    )
    .max(100),
})
export const trialGrantSchema = z.object({
  type_id: z.number().int().positive(),
  amount: z.number().positive().finite(),
  expires: z.date().optional(),
})
