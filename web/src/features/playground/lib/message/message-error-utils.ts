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
import { MESSAGE_STATUS } from '../../constants'
import type { Message } from '../../types'
import { getMessageContent } from './message-utils'

export const MODEL_PRICING_SETTINGS_PATH =
  '/system-settings/billing/model-pricing'

const MODEL_PRICE_ERROR_CODE = 'model_price_error'
// Providers report an over-long request under different codes, and all of them
// mean the same thing for the user: compressing the context is the way out.
export const CONTEXT_LENGTH_ERROR_CODES = new Set([
  'context_length_exceeded',
  'maximum_context_length',
  'context_window_exceeded',
])
export const FALLBACK_ERROR_CONTENT = 'An unknown error occurred'

export function isContextLengthError(errorCode?: string | null): boolean {
  return !!errorCode && CONTEXT_LENGTH_ERROR_CODES.has(errorCode)
}

export function normalizeMessageErrorCode(code: unknown): string | undefined {
  if (typeof code === 'string') return code || undefined
  if (typeof code === 'number' && Number.isFinite(code)) return String(code)
  return undefined
}

type MessageErrorState = {
  content: string
  kind: 'generic' | 'model-price'
  showSettingsLink: boolean
}

export function isAdminRole(role?: number | null): boolean {
  return role != null && role >= 10
}

export function isErrorMessage(message: Message): boolean {
  return message.status === MESSAGE_STATUS.ERROR
}

export function getMessageErrorState(
  message: Message,
  isAdmin: boolean
): MessageErrorState | null {
  if (!isErrorMessage(message)) {
    return null
  }

  const content = getMessageContent(message) || FALLBACK_ERROR_CONTENT
  const isModelPriceError = message.errorCode === MODEL_PRICE_ERROR_CODE

  return {
    content,
    kind: isModelPriceError ? 'model-price' : 'generic',
    showSettingsLink: isModelPriceError && isAdmin,
  }
}
