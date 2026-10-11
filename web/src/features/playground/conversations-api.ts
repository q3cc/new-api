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

import { DEFAULT_CONFIG, DEFAULT_PARAMETER_ENABLED } from './constants'
import {
  messagesSchema,
  parameterEnabledSchema,
  playgroundConfigSchema,
} from './lib/storage/storage-schema'
import type { Message, ParameterEnabled, PlaygroundConfig } from './types'

export type ConversationDocument = {
  messages: Message[]
  config: PlaygroundConfig
  parameterEnabled: ParameterEnabled
  draft: string
  titleGeneration?:
    | 'awaiting_reply'
    | 'ready'
    | 'requested'
    | 'generated'
    | 'failed'
    | 'manual'
}
export type ConversationSummary = {
  id: number
  title: string
  revision: number
  create_time: number
  update_time: number
}
export type SavedConversation = ConversationSummary & {
  document: ConversationDocument
}
export type ConversationWrite = {
  operation_id: string
  revision: number
  title: string
  document: ConversationDocument
}
export type LegacySource = {
  messages: string | null
  config: string | null
  parameter_enabled: string | null
}
export type ImportResult = { conversation_id: number; deleted: boolean }
export const conversationSearchSchema = z.object({
  conversation: z.coerce.number().int().positive().optional().catch(undefined),
})
type Envelope<T> = { success: boolean; data: T; message?: string }
const path = '/api/playground/conversations'

export function emptyConversationDocument(
  config = DEFAULT_CONFIG,
  parameterEnabled = DEFAULT_PARAMETER_ENABLED
): ConversationDocument {
  return {
    messages: [],
    config: { ...config },
    parameterEnabled: { ...parameterEnabled },
    draft: '',
    titleGeneration: 'awaiting_reply',
  }
}

export function parseConversation(row: SavedConversation): SavedConversation {
  let titleGeneration: ConversationDocument['titleGeneration'] = 'manual'
  if (row.title === 'Imported conversation') titleGeneration = 'ready'
  else if (!row.title) titleGeneration = 'awaiting_reply'
  return {
    ...row,
    document: {
      messages: messagesSchema.parse(row.document.messages),
      config: {
        ...DEFAULT_CONFIG,
        ...playgroundConfigSchema.parse(row.document.config),
      },
      parameterEnabled: {
        ...DEFAULT_PARAMETER_ENABLED,
        ...parameterEnabledSchema.parse(row.document.parameterEnabled),
      },
      draft: z.string().parse(row.document.draft),
      titleGeneration: z
        .enum([
          'awaiting_reply',
          'ready',
          'requested',
          'generated',
          'failed',
          'manual',
        ])
        .catch(titleGeneration)
        .parse(row.document.titleGeneration),
    },
  }
}
export async function listConversations(
  keyword: string,
  page: number,
  signal?: AbortSignal
) {
  const res = await api.get<
    Envelope<{ items: ConversationSummary[]; total: number }>
  >(path, {
    params: { keyword, p: page, page_size: 30 },
    signal,
  })
  return requireServerSuccess(res.data).data
}
export async function getConversation(id: number, signal?: AbortSignal) {
  const res = await api.get<Envelope<SavedConversation>>(`${path}/${id}`, {
    signal,
  })
  return parseConversation(requireServerSuccess(res.data).data)
}
export async function writeConversation(
  id: number | null,
  write: ConversationWrite,
  signal?: AbortSignal
) {
  const body = JSON.stringify(write)
  if (new TextEncoder().encode(body).byteLength > 8 * 1024 * 1024) {
    throw new Error('Conversation exceeds the size limit')
  }
  const res =
    id === null
      ? await api.post<Envelope<SavedConversation>>(path, body, {
          signal,
          headers: { 'Content-Type': 'application/json' },
        })
      : await api.put<Envelope<SavedConversation>>(`${path}/${id}`, body, {
          signal,
          headers: { 'Content-Type': 'application/json' },
        })
  return parseConversation(requireServerSuccess(res.data).data)
}
export async function deleteConversation(id: number, signal?: AbortSignal) {
  const res = await api.delete<Envelope<null>>(`${path}/${id}`, { signal })
  requireServerSuccess(res.data)
}
export async function importConversation(
  source: LegacySource,
  signal?: AbortSignal
) {
  const res = await api.post<Envelope<ImportResult>>(
    `${path}/import`,
    { source },
    { signal }
  )
  return requireServerSuccess(res.data).data
}
