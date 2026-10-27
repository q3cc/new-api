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

import { api } from '@/lib/api'
import { requireServerSuccess } from '@/lib/server-error-message'

import type { ChatCompletionMessage } from './types'

export const compressionSettingsSchema = z.object({
  model: z.string(),
  group: z.string().optional(),
  automatic: z.boolean(),
})
export const compressionSchema = z.object({
  summary: z.string().min(1),
  boundary: z.string().min(1),
  sourceHash: z.string().length(64),
  model: z.string(),
  group: z.string().optional(),
  createdAt: z.number().int().positive(),
})
export type CompressionSettings = z.infer<typeof compressionSettingsSchema>
export type Compression = z.infer<typeof compressionSchema>
export type PlaygroundPreference = CompressionSettings & { revision: number }
export type ModelCapability = {
  model: string
  context_window: number
  input_limit: number
  output_limit: number
  text_generation: boolean
  compression_warning: boolean
}
export type ContextEstimate = {
  input_tokens: number
  message_tokens: number[]
  /** The server counted with a fallback tokenizer rather than the model's own. */
  estimated?: boolean
}
type Envelope<T> = { success: boolean; data: T }

export async function getCompressionPreference(signal?: AbortSignal) {
  const response = await api.get<Envelope<PlaygroundPreference>>(
    '/api/playground/settings',
    { signal }
  )
  return requireServerSuccess(response.data).data
}
export async function saveCompressionPreference(
  write: PlaygroundPreference & { operation_id: string },
  signal?: AbortSignal
) {
  const response = await api.put<Envelope<PlaygroundPreference>>(
    '/api/playground/settings',
    write,
    { signal }
  )
  return requireServerSuccess(response.data).data
}
export async function getModelCapabilities(
  group: string,
  signal?: AbortSignal
) {
  const response = await api.get<Envelope<ModelCapability[]>>(
    '/api/playground/model-capabilities',
    { params: { group }, signal }
  )
  return requireServerSuccess(response.data).data
}
// Each message is counted on its own, so a count is reused across requests
// and only messages not seen before are uploaded; typing no longer re-sends
// the whole conversation for every estimate.
const MESSAGE_TOKEN_CACHE_LIMIT = 500
const messageTokenCache = new Map<string, number>()
const requestOverhead = new Map<string, number>()

function messageTokenKey(model: string, message: ChatCompletionMessage) {
  return `${model}\u0000${JSON.stringify(message.content)}`
}

export function clearContextEstimateCache() {
  messageTokenCache.clear()
  requestOverhead.clear()
}

export async function estimateContext(
  model: string,
  group: string,
  messages: ChatCompletionMessage[],
  signal?: AbortSignal
): Promise<ContextEstimate> {
  const keys = messages.map((message) => messageTokenKey(model, message))
  const counts = new Map<string, number>()
  for (const key of keys) {
    const cached = messageTokenCache.get(key)
    if (cached !== undefined) counts.set(key, cached)
  }
  const missing = [...new Set(keys.filter((key) => !counts.has(key)))]
  if (missing.length || !requestOverhead.has(model)) {
    const unique = missing.length ? missing : keys.slice(0, 1)
    const response = await api.post<Envelope<ContextEstimate>>(
      '/api/playground/context/estimate',
      {
        model,
        group,
        messages: unique.map((key) => messages[keys.indexOf(key)]),
      },
      { signal }
    )
    const counted = requireServerSuccess(response.data).data
    for (const [index, key] of unique.entries()) {
      counts.set(key, counted.message_tokens[index])
      messageTokenCache.delete(key)
      messageTokenCache.set(key, counted.message_tokens[index])
    }
    requestOverhead.set(
      model,
      counted.input_tokens -
        counted.message_tokens.reduce((sum, count) => sum + count, 0)
    )
    // Oldest first; this call already holds its own counts.
    while (messageTokenCache.size > MESSAGE_TOKEN_CACHE_LIMIT) {
      const oldest = messageTokenCache.keys().next().value
      if (oldest === undefined) break
      messageTokenCache.delete(oldest)
    }
  }
  const message_tokens = keys.map((key) => counts.get(key) ?? 0)
  return {
    input_tokens:
      (requestOverhead.get(model) ?? 0) +
      message_tokens.reduce((sum, count) => sum + count, 0),
    message_tokens,
  }
}
