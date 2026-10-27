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
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { DEFAULT_CONFIG, DEFAULT_PARAMETER_ENABLED } from '../../constants'
import { createLoadingAssistantMessage } from '../../lib/message/message-utils'
import type { Message } from '../../types'
import { useChatHandler } from '../use-chat-handler'

type Update = (type: 'reasoning' | 'content', chunk: string) => void
const sendStreamRequest = vi.fn()

vi.mock('../use-stream-request', () => ({
  useStreamRequest: () => ({
    sendStreamRequest,
    stopStream: vi.fn(),
    isStreaming: false,
  }),
}))

beforeEach(() => {
  vi.useFakeTimers()
  sendStreamRequest.mockReset()
})
afterEach(() => {
  vi.useRealTimers()
})

it('applies the chunks of one flush window to the reply in a single update', () => {
  const updates: Array<(previous: Message[]) => Message[]> = []
  const { result } = renderHook(() =>
    useChatHandler({
      config: { ...DEFAULT_CONFIG, stream: true },
      parameterEnabled: DEFAULT_PARAMETER_ENABLED,
      onMessageUpdate: (updater) => updates.push(updater),
    })
  )
  const reply = createLoadingAssistantMessage()
  act(() => result.current.sendChat([reply]))
  expect(sendStreamRequest).toHaveBeenCalledTimes(1)
  const onUpdate = sendStreamRequest.mock.calls[0][1] as Update

  act(() => {
    onUpdate('reasoning', 'thinking')
    onUpdate('content', 'Hel')
    onUpdate('content', 'lo')
    onUpdate('content', ', world')
  })
  expect(updates).toHaveLength(0)
  act(() => vi.advanceTimersByTime(50))
  expect(updates).toHaveLength(1)
  const [updated] = updates[0]([reply])
  expect(updated.versions[0].content).toBe('Hello, world')
  expect(updated.reasoning?.content).toBe('thinking')
  expect(updated.status).toBe('streaming')

  // A later chunk opens a new window of its own.
  act(() => onUpdate('content', '!'))
  act(() => vi.advanceTimersByTime(50))
  expect(updates).toHaveLength(2)
})

it('discards chunks that belong to a request that was stopped', () => {
  const updates: Array<(previous: Message[]) => Message[]> = []
  const { result } = renderHook(() =>
    useChatHandler({
      config: { ...DEFAULT_CONFIG, stream: true },
      parameterEnabled: DEFAULT_PARAMETER_ENABLED,
      onMessageUpdate: (updater) => updates.push(updater),
    })
  )
  act(() => result.current.sendChat([createLoadingAssistantMessage()]))
  const onUpdate = sendStreamRequest.mock.calls[0][1] as Update
  act(() => onUpdate('content', 'late'))
  act(() => result.current.stopGeneration())
  const before = updates.length
  act(() => vi.advanceTimersByTime(50))
  expect(updates).toHaveLength(before)
})
