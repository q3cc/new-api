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
import { describe, expect, it, vi } from 'vitest'

import { FetchEventSource, type StreamEvent } from '../fetch-event-source'

function streamOf(chunks: string[], init?: ResponseInit) {
  const encoder = new TextEncoder()
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
      controller.close()
    },
  })
  return new Response(body, { status: 200, ...init })
}

function record(source: FetchEventSource) {
  const events: { type: string; data?: string; readyState?: number }[] = []
  for (const type of ['message', 'error', 'readystatechange', 'open']) {
    source.addEventListener(type, (event: StreamEvent) =>
      events.push({ type, data: event.data, readyState: event.readyState })
    )
  }
  return events
}

async function settle() {
  for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0))
}

describe('FetchEventSource', () => {
  it('joins chunks that end mid-line and data lines that span several lines', async () => {
    const fetchMock = vi.fn(async () =>
      streamOf([
        'data: {"a":',
        '1}\n\ndata: first\r\ndata: second\n\n',
        ': comment\nevent: message\ndata: [DONE]\n\n',
      ])
    )
    const source = new FetchEventSource('/pg', {
      headers: { Authorization: 'Bearer t' },
      body: '{}',
      fetch: fetchMock as unknown as typeof fetch,
    })
    const events = record(source)
    source.stream()
    await settle()
    expect(
      events.filter((e) => e.type === 'message').map((e) => e.data)
    ).toEqual(['{"a":1}', 'first\nsecond', '[DONE]'])
    expect(source.status).toBe(200)
    expect(events.at(-1)).toMatchObject({
      type: 'readystatechange',
      readyState: 2,
    })
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(init.credentials).toBe('include')
    expect(init.headers).toMatchObject({
      Authorization: 'Bearer t',
      Accept: 'text/event-stream',
      'Content-Type': 'application/json',
    })
  })

  it('reports a refused request with its body and status before closing', async () => {
    const source = new FetchEventSource('/pg', {
      headers: {},
      body: '{}',
      fetch: (async () =>
        new Response('{"error":{"message":"Too many requests"}}', {
          status: 429,
        })) as unknown as typeof fetch,
    })
    const events = record(source)
    source.stream()
    await settle()
    expect(source.status).toBe(429)
    expect(events.map((e) => e.type)).toEqual(['error', 'readystatechange'])
    expect(events[0].data).toBe('{"error":{"message":"Too many requests"}}')
  })

  it('reports a connection that never reached the server as status 0', async () => {
    const source = new FetchEventSource('/pg', {
      headers: {},
      body: '{}',
      fetch: (async () => {
        throw new TypeError('Failed to fetch')
      }) as unknown as typeof fetch,
    })
    const events = record(source)
    source.stream()
    await settle()
    expect(source.status).toBe(0)
    expect(events.map((e) => e.type)).toEqual(['error', 'readystatechange'])
    expect(events[0].data).toBeUndefined()
  })

  it('ends with a ready state change when the server closes before DONE', async () => {
    const source = new FetchEventSource('/pg', {
      headers: {},
      body: '{}',
      fetch: (async () =>
        streamOf(['data: partial\n\n'])) as unknown as typeof fetch,
    })
    const events = record(source)
    source.stream()
    await settle()
    expect(events.map((e) => e.type)).toEqual([
      'open',
      'message',
      'readystatechange',
    ])
    expect(events.at(-1)?.readyState).toBe(2)
  })

  it('delivers nothing after it is closed', async () => {
    let release: () => void = () => undefined
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: one\n\n'))
        release = () => {
          controller.enqueue(new TextEncoder().encode('data: two\n\n'))
          controller.close()
        }
      },
    })
    const source = new FetchEventSource('/pg', {
      headers: {},
      body: '{}',
      fetch: (async () =>
        new Response(body, { status: 200 })) as unknown as typeof fetch,
    })
    const events = record(source)
    source.stream()
    await settle()
    expect(events.filter((e) => e.type === 'message')).toHaveLength(1)
    source.close()
    release()
    await settle()
    expect(events.filter((e) => e.type === 'message')).toHaveLength(1)
    expect(events.some((e) => e.type === 'readystatechange')).toBe(false)
    expect(source.readyState).toBe(2)
  })
})
