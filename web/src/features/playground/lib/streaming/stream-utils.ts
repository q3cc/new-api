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

import { ERROR_MESSAGES } from '../../constants'
import { normalizeMessageErrorCode } from '../message/message-error-utils'

const STREAM_DONE_MESSAGE = '[DONE]'
const STREAM_CLOSED_READY_STATE = 2

export type StreamUpdateType = 'reasoning' | 'content'

export type StreamMessageUpdate = {
  type: StreamUpdateType
  chunk: string
}

// What arrives over the wire is checked rather than assumed; a payload of
// another shape is ignored instead of crashing the stream.
const streamErrorPayloadSchema = z.object({
  error: z
    .union([
      z.string(),
      z.object({
        code: z.unknown().optional(),
        message: z.unknown().optional(),
      }),
    ])
    .nullish(),
})
const streamChunkSchema = z.object({
  choices: z
    .array(
      z.object({
        delta: z
          .object({
            content: z.string().nullish(),
            reasoning_content: z.string().nullish(),
            reasoning: z.string().nullish(),
          })
          .optional(),
      })
    )
    .optional(),
})

export type StreamErrorDetails = {
  errorCode?: string
  errorMessage: string
}

/**
 * Reads the error a stream reported. A connection that never reached the
 * server has no status and no body, which is a network failure, not a
 * request error.
 */
export function parseStreamErrorDetails(
  data?: string,
  status?: number
): StreamErrorDetails {
  if (!data) {
    return {
      errorMessage:
        status === 0 || status === undefined
          ? ERROR_MESSAGES.NETWORK_ERROR
          : ERROR_MESSAGES.API_REQUEST_ERROR,
    }
  }
  const fallbackMessage = data

  let parsed: unknown
  try {
    parsed = JSON.parse(data)
  } catch {
    return { errorMessage: fallbackMessage }
  }
  const payload = streamErrorPayloadSchema.safeParse(parsed)
  if (!payload.success || !payload.data.error) {
    return { errorMessage: fallbackMessage }
  }
  const error = payload.data.error
  if (typeof error === 'string') {
    return { errorMessage: error }
  }
  return {
    errorCode: normalizeMessageErrorCode(error.code),
    errorMessage:
      typeof error.message === 'string' && error.message
        ? error.message
        : fallbackMessage,
  }
}

export function parseStreamMessage(data: string): {
  updates: StreamMessageUpdate[]
  error?: StreamErrorDetails
} {
  const parsed: unknown = JSON.parse(data)
  const failure = streamErrorPayloadSchema.safeParse(parsed)
  if (failure.success && failure.data.error != null) {
    return { updates: [], error: parseStreamErrorDetails(data) }
  }
  const chunk = streamChunkSchema.safeParse(parsed)
  const delta = chunk.success ? chunk.data.choices?.[0]?.delta : undefined

  if (!delta) {
    return { updates: [] }
  }

  const updates: StreamMessageUpdate[] = []
  const reasoning = delta.reasoning_content ?? delta.reasoning

  if (reasoning) {
    updates.push({ type: 'reasoning', chunk: reasoning })
  }

  if (delta.content) {
    updates.push({ type: 'content', chunk: delta.content })
  }

  return { updates }
}

export function isStreamDoneMessage(data: string): boolean {
  return data === STREAM_DONE_MESSAGE
}

export function getStreamReadyStateError(
  eventReadyState: number | undefined,
  source: unknown
): string | null {
  const status = (source as { status?: number }).status

  if (
    eventReadyState !== undefined &&
    eventReadyState >= STREAM_CLOSED_READY_STATE
  ) {
    return status !== undefined && status !== 200
      ? `HTTP ${status}: ${ERROR_MESSAGES.CONNECTION_CLOSED}`
      : ERROR_MESSAGES.CONNECTION_CLOSED
  }

  return null
}
