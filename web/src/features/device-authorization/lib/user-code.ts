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

export const deviceAuthorizationSearchSchema = z.object({
  code: z.string().max(32).optional().catch(undefined),
})

/** Keeps the letters of a user code, upper-cased, as the server compares it. */
export function normalizeUserCode(value: string): string {
  return value.toUpperCase().replaceAll(/[^A-Z]/g, '').slice(0, 8)
}

/** Shows an eight-letter code as XXXX-XXXX, the way the app displays it. */
export function formatUserCode(code: string): string {
  return code.length === 8 ? `${code.slice(0, 4)}-${code.slice(4)}` : code
}
