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
/**
 * A server-sent events source over fetch. It offers what the stream request
 * controller used from sse.js: 'message' events with the event's data,
 * 'error' events carrying the response body of a failed request, and
 * 'readystatechange' when the connection ends. Unlike an XHR-based source,
 * the body is read as it arrives instead of accumulating in memory, and the
 * HTTP status is known as soon as the headers are in.
 */
export type StreamEvent = Event & { data?: string; readyState?: number }
export type StreamEventListener = (event: StreamEvent) => void

export const READY_STATE_CONNECTING = 0
export const READY_STATE_OPEN = 1
export const READY_STATE_CLOSED = 2

type FetchEventSourceInit = {
  headers: Record<string, string>
  body: string
  /** Defaults to the global fetch; tests pass their own. */
  fetch?: typeof fetch
}

export class FetchEventSource {
  readyState = READY_STATE_CONNECTING
  /** The HTTP status once the headers arrived; 0 when the request failed. */
  status: number | undefined
  private readonly listeners = new Map<string, StreamEventListener[]>()
  private readonly controller = new AbortController()
  private closed = false
  private started = false
  private finished = false

  constructor(
    private readonly url: string,
    private readonly init: FetchEventSourceInit
  ) {}

  addEventListener(type: string, listener: StreamEventListener) {
    const listeners = this.listeners.get(type) ?? []
    listeners.push(listener)
    this.listeners.set(type, listeners)
  }

  close() {
    if (this.closed) return
    this.closed = true
    this.readyState = READY_STATE_CLOSED
    // A response that was read to its end has nothing left to abort.
    if (!this.finished) this.controller.abort()
  }

  stream() {
    if (this.started) return
    this.started = true
    void this.run()
  }

  // Nothing is delivered after close(): the consumer has moved on.
  private dispatch(type: string, data?: string) {
    if (this.closed) return
    const event = new Event(type) as StreamEvent
    event.data = data
    event.readyState = this.readyState
    for (const listener of this.listeners.get(type) ?? []) listener(event)
  }

  private finish() {
    this.finished = true
    if (this.closed) return
    this.readyState = READY_STATE_CLOSED
    this.dispatch('readystatechange')
  }

  private async run() {
    const doFetch = this.init.fetch ?? fetch
    let response: Response
    try {
      response = await doFetch(this.url, {
        method: 'POST',
        headers: {
          ...this.init.headers,
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
        },
        body: this.init.body,
        credentials: 'include',
        signal: this.controller.signal,
      })
    } catch {
      if (this.closed) return
      this.status = 0
      this.dispatch('error')
      this.finish()
      return
    }
    if (this.closed) return
    this.status = response.status
    if (!response.ok) {
      // The body explains the refusal; it is read whole since it is short.
      let body = ''
      try {
        body = await response.text()
      } catch {
        body = ''
      }
      if (this.closed) return
      this.dispatch('error', body)
      this.finish()
      return
    }
    this.readyState = READY_STATE_OPEN
    this.dispatch('open')
    if (!response.body) {
      this.finish()
      return
    }
    try {
      await this.read(response.body)
    } catch {
      if (this.closed) return
      this.dispatch('error')
    }
    this.finish()
  }

  // Lines are buffered until a blank line ends the event, as the SSE
  // specification requires; a chunk may end in the middle of a line.
  private async read(body: ReadableStream<Uint8Array>) {
    const reader = body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let eventType = 'message'
    let data: string[] = []
    const flush = () => {
      if (data.length) this.dispatch(eventType, data.join('\n'))
      eventType = 'message'
      data = []
    }
    const handleLine = (line: string) => {
      if (line === '') {
        flush()
        return
      }
      if (line.startsWith(':')) return
      const colon = line.indexOf(':')
      const field = colon === -1 ? line : line.slice(0, colon)
      let value = colon === -1 ? '' : line.slice(colon + 1)
      if (value.startsWith(' ')) value = value.slice(1)
      if (field === 'data') data.push(value)
      else if (field === 'event') eventType = value || 'message'
    }
    for (;;) {
      const { done, value } = await reader.read()
      if (this.closed) return
      buffer += decoder.decode(value, { stream: !done })
      const lines = buffer.split('\n')
      buffer = done ? '' : (lines.pop() ?? '')
      for (const line of lines) {
        handleLine(line.endsWith('\r') ? line.slice(0, -1) : line)
      }
      if (done) {
        if (buffer) handleLine(buffer)
        flush()
        return
      }
    }
  }
}
