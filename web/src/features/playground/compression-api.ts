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
  automatic: z.boolean(),
})
export const compressionSchema = z.object({
  summary: z.string().min(1),
  boundary: z.string().min(1),
  sourceHash: z.string().length(64),
  model: z.string(),
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
export type ContextEstimate = { input_tokens: number; message_tokens: number[] }
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
export async function estimateContext(
  model: string,
  group: string,
  messages: ChatCompletionMessage[],
  signal?: AbortSignal
) {
  const response = await api.post<Envelope<ContextEstimate>>(
    '/api/playground/context/estimate',
    { model, group, messages },
    { signal }
  )
  return requireServerSuccess(response.data).data
}
