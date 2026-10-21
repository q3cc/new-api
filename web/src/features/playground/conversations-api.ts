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
import { isAxiosError } from 'axios'
import { z } from 'zod'

import { api } from '@/lib/api'
import { requireServerSuccess } from '@/lib/server-error-message'

import {
  compressionSchema,
  compressionSettingsSchema,
  type Compression,
  type CompressionSettings,
} from './compression-api'
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
  compressionSettings?: CompressionSettings
  contextLimits?: Record<string, number>
  compression?: Compression
  compressionAttempt?: 'requested' | 'failed'
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
export type ImportProgress = {
  uploaded: number
  total: number
  phase: 'uploading' | 'verifying' | 'complete'
}
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
      compressionSettings: compressionSettingsSchema
        .optional()
        .parse(row.document.compressionSettings),
      contextLimits: z
        .record(z.string(), z.number().int().positive())
        .optional()
        .parse(row.document.contextLimits),
      compression: compressionSchema.optional().parse(row.document.compression),
      compressionAttempt: z
        .enum(['requested', 'failed'])
        .optional()
        .parse(row.document.compressionAttempt),
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
  // The caller keeps the document it sent, so only the saved metadata comes
  // back instead of a second copy of the whole conversation.
  const config = {
    signal,
    params: { return: 'meta' },
    headers: { 'Content-Type': 'application/json' },
  }
  const res =
    id === null
      ? await api.post<Envelope<ConversationSummary>>(path, body, config)
      : await api.put<Envelope<ConversationSummary>>(
          `${path}/${id}`,
          body,
          config
        )
  const saved = requireServerSuccess(res.data).data
  return {
    id: saved.id,
    title: saved.title,
    revision: saved.revision,
    create_time: saved.create_time,
    update_time: saved.update_time,
  }
}
export async function deleteConversation(id: number, signal?: AbortSignal) {
  const res = await api.delete<Envelope<null>>(`${path}/${id}`, { signal })
  requireServerSuccess(res.data)
}
export async function importConversation(
  source: LegacySource,
  signal?: AbortSignal,
  onProgress?: (progress: ImportProgress) => void
) {
  const bytes = new TextEncoder().encode(JSON.stringify(source))
  if (bytes.length > 8 * 1024 * 1024) {
    throw new Error('Conversation exceeds the size limit')
  }
  const controller = new AbortController()
  const uploadSignal = signal
    ? AbortSignal.any([signal, controller.signal])
    : controller.signal
  const fingerprint = await playgroundUploadHash(bytes)
  const uploadPath = `${path}/import/chunks/${fingerprint}`
  const chunkSize = 256 * 1024
  let uploaded = 0
  onProgress?.({ uploaded, total: bytes.length, phase: 'uploading' })
  try {
    const statusResponse = await retryPlaygroundUpload(
      () =>
        api.get<
          Envelope<{
            chunks: Record<string, string>
            result?: ImportResult
          }>
        >(uploadPath, {
          params: { size: bytes.length },
          signal: uploadSignal,
          disableDuplicate: true,
          skipErrorHandler: true,
        }),
      uploadSignal
    )
    const status = requireServerSuccess(statusResponse.data).data
    if (status.result) {
      onProgress?.({
        uploaded: bytes.length,
        total: bytes.length,
        phase: 'complete',
      })
      return status.result
    }
    let nextIndex = 0
    const count = Math.ceil(bytes.length / chunkSize)
    await Promise.all(
      Array.from({ length: Math.min(3, count) }, async () => {
        while (nextIndex < count) {
          uploadSignal.throwIfAborted()
          const index = nextIndex++
          const chunk = bytes.slice(index * chunkSize, (index + 1) * chunkSize)
          const hash = await playgroundUploadHash(chunk)
          if (status.chunks[String(index)] !== hash) {
            const content = btoa(
              Array.from(chunk, (byte) => String.fromCharCode(byte)).join('')
            )
            const response = await retryPlaygroundUpload(
              () =>
                api.put<Envelope<null>>(
                  uploadPath,
                  { size: bytes.length, index, hash, content },
                  { signal: uploadSignal, skipErrorHandler: true }
                ),
              uploadSignal
            )
            requireServerSuccess(response.data)
          }
          uploaded += chunk.length
          onProgress?.({ uploaded, total: bytes.length, phase: 'uploading' })
        }
      })
    )
    onProgress?.({ uploaded, total: bytes.length, phase: 'verifying' })
    const response = await retryPlaygroundUpload(
      () =>
        api.post<Envelope<ImportResult>>(
          `${uploadPath}/complete`,
          { size: bytes.length },
          { signal: uploadSignal, skipErrorHandler: true }
        ),
      uploadSignal
    )
    const result = requireServerSuccess(response.data).data
    onProgress?.({ uploaded, total: bytes.length, phase: 'complete' })
    return result
  } finally {
    controller.abort()
  }
}

async function playgroundUploadHash(bytes: Uint8Array<ArrayBuffer>) {
  if (!crypto.subtle) {
    const { default: forge } = await import('node-forge')
    const digest = forge.md.sha256.create()
    digest.update(
      Array.from(bytes, (byte) => String.fromCharCode(byte)).join(''),
      'raw'
    )
    return digest.digest().toHex()
  }
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0')
  ).join('')
}

async function retryPlaygroundUpload<T>(
  request: () => Promise<T>,
  signal: AbortSignal
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    signal.throwIfAborted()
    try {
      return await request()
    } catch (error) {
      const status = isAxiosError(error) ? error.response?.status : undefined
      if (
        signal.aborted ||
        attempt >= 3 ||
        (status !== undefined && status !== 429 && status < 500)
      ) {
        throw error
      }
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(
          () => {
            signal.removeEventListener('abort', abort)
            resolve()
          },
          300 * 2 ** attempt
        )
        function abort() {
          clearTimeout(timer)
          reject(signal.reason)
        }
        signal.addEventListener('abort', abort, { once: true })
      })
    }
  }
}
