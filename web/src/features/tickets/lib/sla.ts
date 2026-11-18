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

const MINUTE = 60
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/** How far an open ticket is from, or past, its response target. */
export type ResponseDue = {
  overdue: boolean
  /** Seconds left, or seconds past, the target; never negative. */
  seconds: number
}

export function responseDue(dueAt: number, nowSeconds: number): ResponseDue {
  return { overdue: nowSeconds > dueAt, seconds: Math.abs(dueAt - nowSeconds) }
}

/**
 * Formats a response-target span the way support reads it at a glance:
 * minutes under an hour, whole hours under two days, whole days beyond.
 * `locale` must already be an Intl locale (see toIntlLocale).
 */
export function formatSlaDuration(seconds: number, locale?: string): string {
  let value = Math.max(1, Math.floor(seconds / MINUTE))
  let unit = 'minute'
  if (seconds >= 2 * DAY) {
    value = Math.floor(seconds / DAY)
    unit = 'day'
  } else if (seconds >= HOUR) {
    value = Math.floor(seconds / HOUR)
    unit = 'hour'
  }
  return new Intl.NumberFormat(locale, {
    style: 'unit',
    unit,
    unitDisplay: 'long',
  }).format(value)
}
