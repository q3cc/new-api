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
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { assert, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'

import {
  renderPlayground,
  server,
  setupPlaygroundServer,
} from './helpers/fake-playground-server'

setupPlaygroundServer()

it('shows the current context and draft usage from the input toolbar and updates after editing', async () => {
  server.modelCapabilities = [
    {
      model: 'test-model',
      context_window: 4120,
      input_limit: 0,
      output_limit: 0,
      text_generation: true,
      compression_warning: false,
    },
  ]
  renderPlayground()
  const ring = await screen.findByRole('button', {
    name: 'Model context usage',
  })
  await waitFor(() =>
    expect(ring).toHaveAccessibleDescription('11 / 24 tokens · 45.83%')
  )
  fireEvent.pointerEnter(ring, { pointerType: 'mouse' })
  fireEvent.mouseOver(ring)
  fireEvent.mouseEnter(ring)
  fireEvent.mouseMove(ring)
  expect(await screen.findByText('11 / 24 tokens · 45.83%')).toBeVisible()
  fireEvent.mouseLeave(ring)
  fireEvent.click(ring)
  expect(
    await screen.findByRole('button', { name: 'Compression settings' })
  ).toBeEnabled()
  expect(
    screen.getByRole('button', { name: 'Compress context' })
  ).toBeDisabled()
  fireEvent.click(ring)
  fireEvent.change(screen.getByPlaceholderText('Ask anything'), {
    target: { value: 'A longer draft' },
  })
  await waitFor(() =>
    expect(ring).toHaveAccessibleDescription('14 / 24 tokens · 58.33%')
  )
  expect(server.completions).toHaveLength(0)
})

it('opens context actions on a touch long press without closing on release and shows unknown limits honestly', async () => {
  renderPlayground()
  const ring = await screen.findByRole('button', {
    name: 'Model context usage',
  })
  // Without a known window the count is shown with the assumption spelled
  // out, never as a share of a guessed limit.
  await waitFor(() =>
    expect(ring).toHaveAccessibleDescription(
      /^[\d,]+ tokens \(assuming a [\d,]+ token window\)$/
    )
  )
  vi.useFakeTimers()
  try {
    fireEvent.pointerDown(ring, {
      clientX: 10,
      clientY: 10,
      pointerType: 'touch',
    })
    // A resting finger still jitters, so a small drift keeps the press alive.
    fireEvent.pointerMove(ring, {
      clientX: 14,
      clientY: 12,
      pointerType: 'touch',
    })
    await act(async () => vi.advanceTimersByTime(450))
    expect(
      screen.getByRole('button', { name: 'Compression settings' })
    ).toBeVisible()
    fireEvent.pointerUp(ring, { pointerType: 'touch' })
    fireEvent.click(ring)
    expect(
      screen.getByRole('button', { name: 'Compression settings' })
    ).toBeVisible()
  } finally {
    vi.useRealTimers()
  }
  expect(server.completions).toHaveLength(0)
})

it('cancels the touch long press when the finger drags the message list instead of pressing', async () => {
  renderPlayground()
  const ring = await screen.findByRole('button', {
    name: 'Model context usage',
  })
  vi.useFakeTimers()
  try {
    fireEvent.pointerDown(ring, {
      clientX: 10,
      clientY: 10,
      pointerType: 'touch',
    })
    fireEvent.pointerMove(ring, {
      clientX: 10,
      clientY: 96,
      pointerType: 'touch',
    })
    await act(async () => vi.advanceTimersByTime(450))
    expect(
      screen.queryByRole('button', { name: 'Compression settings' })
    ).not.toBeInTheDocument()
  } finally {
    vi.useRealTimers()
  }
  expect(server.completions).toHaveLength(0)
})

it('selects an independent compression group and saves the default model without changing the chat group', async () => {
  server.groupCapabilities.DSS = [
    {
      model: 'gpt-4o-mini',
      context_window: 128000,
      input_limit: 0,
      output_limit: 16384,
      text_generation: true,
      compression_warning: false,
    },
  ]
  renderPlayground()
  fireEvent.click(
    await screen.findByRole('button', { name: 'Model context usage' })
  )
  fireEvent.click(
    await screen.findByRole('button', { name: 'Compression settings' })
  )
  const dialog = await screen.findByRole('dialog', {
    name: 'Compression settings',
  })
  fireEvent.click(within(dialog).getByRole('tab', { name: 'Default settings' }))
  fireEvent.click(
    within(dialog).getByRole('combobox', { name: 'Current conversation group' })
  )
  fireEvent.click(await screen.findByRole('option', { name: /^DSS/ }))
  await waitFor(() =>
    expect(server.preference).toMatchObject({
      group: 'DSS',
      model: '',
      automatic: false,
    })
  )
  const picker = within(dialog).getByRole('combobox', { name: 'Model' })
  await waitFor(() => expect(picker).toBeEnabled())
  fireEvent.click(picker)
  fireEvent.click(await screen.findByRole('option', { name: 'gpt-4o-mini' }))
  await waitFor(() =>
    expect(server.preference).toMatchObject({
      group: 'DSS',
      model: 'gpt-4o-mini',
      automatic: true,
    })
  )
  expect(server.records.get(1)?.document.config).toMatchObject({
    model: 'test-model',
    group: 'default',
  })
  fireEvent.click(
    within(dialog).getByRole('tab', { name: 'This conversation' })
  )
  expect(within(dialog).getByRole('combobox', { name: 'DSS' })).toBeVisible()
})

it.each(['conversation', 'default', 'legacy'])(
  'compresses using the %s group setting and keeps chat requests in their own group',
  async (scope) => {
    server.modelCapabilities = [
      {
        model: 'test-model',
        context_window: 5000,
        input_limit: 0,
        output_limit: 0,
        text_generation: true,
        compression_warning: false,
      },
      {
        model: 'other-model',
        context_window: 128000,
        input_limit: 0,
        output_limit: 0,
        text_generation: true,
        compression_warning: false,
      },
    ]
    const first = server.records.get(1)
    assert(first)
    const settings = {
      model: 'other-model',
      group: scope === 'legacy' ? undefined : 'DSS',
      automatic: true,
    }
    if (scope === 'default') server.preference = { ...settings, revision: 1 }
    else first.document.compressionSettings = settings
    if (scope !== 'legacy') {
      server.groupCapabilities = {
        default: [server.modelCapabilities[0]],
        DSS: [server.modelCapabilities[1]],
      }
    }
    first.document.messages = Array.from({ length: 8 }, (_, index) => ({
      key: `history-${index}`,
      from: index % 2 ? 'assistant' : 'user',
      status: 'complete',
      versions: [
        { id: `original-${index}`, content: String(index).repeat(100) },
      ],
    }))
    const original = structuredClone(first.document.messages)
    renderPlayground()
    await screen.findByDisplayValue('draft Alpha')
    fireEvent.change(screen.getByPlaceholderText('Ask anything'), {
      target: { value: 'Continue' },
    })
    fireEvent.click(screen.getAllByRole('button', { name: /^Send/ })[0])
    await waitFor(() => expect(server.completions).toHaveLength(1))
    const calls = () =>
      vi
        .mocked(api.post)
        .mock.calls.filter(([url]) => url === '/pg/chat/completions')
    // The summary request is the first and only compression request and
    // already uses the compression model, so a separate group never leaks
    // into the chat request.
    expect(calls()[0][1]).toMatchObject({
      model: 'other-model',
      group: scope === 'legacy' ? 'default' : 'DSS',
      max_tokens: 4096,
      stream: false,
    })
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Export conversation' })
      ).toBeDisabled()
    )
    expect(server.records.get(1)?.document.compressionAttempt).toBe('requested')
    await act(async () => server.completions[0].finish('Summary'))
    await waitFor(() => expect(server.completions).toHaveLength(2))
    expect(server.records.get(1)?.document.compression?.summary).toBe(
      '## Context handoff\nSummary'
    )
    expect(calls()[1][1]).toMatchObject({
      model: 'test-model',
      group: 'default',
    })
    expect(calls()[1][1]).not.toHaveProperty('max_tokens')
    await act(async () => server.completions[1].finish('Continued reply'))
    await screen.findByText('Continued reply')
    expect(server.records.get(1)?.document.messages.slice(0, 8)).toEqual(
      original
    )
  }
)

it('compresses with the chat model, learns its limit and retries when an unknown model rejects the context as too long', async () => {
  // The model is outside the capability table and no compression model is
  // configured; the provider reports the overflow only in text.
  const first = server.records.get(1)
  assert(first)
  first.document.messages = Array.from({ length: 8 }, (_, index) => ({
    key: `history-${index}`,
    from: index % 2 ? 'assistant' : 'user',
    status: 'complete',
    versions: [{ id: `original-${index}`, content: String(index).repeat(100) }],
  }))
  renderPlayground()
  await screen.findByDisplayValue('draft Alpha')
  server.completionError = {
    message:
      "This model's maximum context length is 32768 tokens. However, your messages resulted in 40000 tokens.",
  }
  fireEvent.change(screen.getByPlaceholderText('Ask anything'), {
    target: { value: 'Continue' },
  })
  fireEvent.click(screen.getAllByRole('button', { name: /^Send/ })[0])
  const shortcut = await screen.findByRole('button', {
    name: 'Compress context and retry',
  })
  expect(server.completions).toHaveLength(0)
  server.completionError = null
  fireEvent.click(shortcut)
  await waitFor(() => expect(server.completions).toHaveLength(1))
  const calls = () =>
    vi
      .mocked(api.post)
      .mock.calls.filter(([url]) => url === '/pg/chat/completions')
      .map(([, body]) => body as { model: string; messages: unknown[] })
  const summaryRequest = calls().at(-1)
  expect(summaryRequest?.model).toBe('test-model')
  expect(summaryRequest?.messages.at(-1)).toMatchObject({ role: 'user' })
  await waitFor(() =>
    expect(server.records.get(1)?.document.contextLimits).toEqual({
      'test-model': 32768,
    })
  )
  await act(async () =>
    server.completions[0].finish('Summary of the earlier work')
  )
  await waitFor(() =>
    expect(server.records.get(1)?.document.compression?.summary).toBe(
      '## Context handoff\nSummary of the earlier work'
    )
  )
  // The failed reply is retried once, now against the compressed context.
  await waitFor(() => expect(server.completions).toHaveLength(2))
  await act(async () =>
    server.completions[1].finish('Continued after compression')
  )
  await screen.findByText('Continued after compression')
})

it('explains instead of offering compression when an over-long request has no older turns to summarize', async () => {
  renderPlayground()
  await screen.findByDisplayValue('draft Alpha')
  server.completionError = {
    code: 'context_length_exceeded',
    message: 'Input is too long',
  }
  fireEvent.change(screen.getByPlaceholderText('Ask anything'), {
    target: { value: 'A single very long message' },
  })
  fireEvent.click(screen.getAllByRole('button', { name: /^Send/ })[0])
  await screen.findByText(
    'The conversation is too short to compress. Shorten the message or start a new conversation.'
  )
  expect(
    screen.queryByRole('button', { name: 'Compress context and retry' })
  ).not.toBeInTheDocument()
})
