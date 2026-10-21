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

// Many providers send an over-long request back without one of those codes,
// only as text. These phrases cover OpenAI-compatible servers (including vLLM
// and DeepSeek), Anthropic, Gemini, Qwen and Chinese-language gateways.
const CONTEXT_LENGTH_ERROR_PATTERNS = [
  /context[_ ]length[_ ]exceeded/i,
  /maximum context length/i,
  /context (?:window|length) (?:of|is|exceeded|limit)/i,
  /exceeds? (?:the )?(?:model'?s? )?(?:maximum )?context (?:window|length)/i,
  /prompt is too long/i,
  /input token count.*exceeds the maximum/i,
  /input (?:token )?limit/i,
  /too many (?:input )?tokens/i,
  /token.*exceed.*limit|exceed.*token.*limit/i,
  /exceed.*max_prompt_tokens/i,
  /reduce the length of the messages/i,
  /range of input length should be/i,
  /上下文(?:长度|窗口)?.{0,6}(?:超出|超过|超限)/,
  /(?:超出|超过)(?:了)?(?:模型)?(?:最大)?(?:上下文|输入)长度/,
]

// Throughput limits also talk about tokens and limits ("exceeded token rate
// limit", "tokens per minute"); compressing does not help with those.
const RATE_LIMIT_PATTERN =
  /rate.?limit|quota|per (?:minute|min|second|day)|\b[TR]P[MD]\b|限流|频率/i

export function isContextLengthError(
  errorCode?: string | null,
  content?: string | null
): boolean {
  if (errorCode && CONTEXT_LENGTH_ERROR_CODES.has(errorCode)) return true
  if (!content || RATE_LIMIT_PATTERN.test(content)) return false
  return CONTEXT_LENGTH_ERROR_PATTERNS.some((pattern) => pattern.test(content))
}

// Phrasings that state the real window, so a conversation can budget for a
// model the capability table does not know.
const CONTEXT_LIMIT_PATTERNS = [
  /maximum context length is (\d[\d,]*)/i,
  /\d[\d,]* tokens? > (\d[\d,]*) maximum/i,
  /maximum number of tokens allowed \((\d[\d,]*)\)/i,
  /context (?:window|length) (?:of|is) (\d[\d,]*)/i,
  /(?:limit|maximum) (?:of|is) (\d[\d,]*) (?:input )?tokens/i,
  /range of input length should be \[\d+, *(\d+)\]/i,
]
const MIN_LEARNED_CONTEXT_LIMIT = 1024
const MAX_LEARNED_CONTEXT_LIMIT = 10_000_000

export function parseContextLimit(content?: string | null): number | undefined {
  if (!content) return undefined
  for (const pattern of CONTEXT_LIMIT_PATTERNS) {
    const match = pattern.exec(content)
    if (!match) continue
    const limit = Number(match[1].replaceAll(',', ''))
    if (
      Number.isSafeInteger(limit) &&
      limit >= MIN_LEARNED_CONTEXT_LIMIT &&
      limit <= MAX_LEARNED_CONTEXT_LIMIT
    ) {
      return limit
    }
  }
  return undefined
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
