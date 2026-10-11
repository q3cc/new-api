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
import * as z from 'zod'

export const paymentMethodFields = {
  name: z.string().trim().min(1, 'Payment method name is required'),
  type: z
    .string()
    .trim()
    .min(1, 'Payment type key is required')
    .refine(
      (value) =>
        new TextEncoder().encode(value).length <= 50 &&
        !/[\s\p{Cc}]/u.test(value),
      'Enter a payment method name and a valid type key'
    ),
}

export function paymentMethodIdentity(method: {
  type: string
  epay_endpoint_id?: string
}) {
  const builtin = [
    'stripe',
    'creem',
    'waffo',
    'waffo_pancake',
    'balance',
  ].includes(method.type)
  return JSON.stringify([
    method.type,
    builtin ? '' : (method.epay_endpoint_id ?? ''),
  ])
}

export const paymentMethodsSchema = z
  .array(z.object(paymentMethodFields).catchall(z.string()))
  .max(100)
  .superRefine((methods, ctx) => {
    const seen = new Set<string>()
    for (const [index, method] of methods.entries()) {
      const identity = paymentMethodIdentity(method)
      if (seen.has(identity)) {
        ctx.addIssue({
          code: 'custom',
          path: [index, 'type'],
          message: 'This payment type is already configured for this service',
        })
      }
      seen.add(identity)
    }
  })
