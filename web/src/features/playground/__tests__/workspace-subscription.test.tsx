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
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, assert, beforeEach, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'
import { useAuthStore } from '@/stores/auth-store'

import { emptyConversationDocument } from '../conversations-api'
import { useConversationEntry } from '../hooks/use-workspace'
import { ConversationWorkspace } from '../lib/conversation-workspace'
import * as pending from '../lib/storage/pending-conversations'

const renders = new Map<string, number>()

function Probe(props: { workspace: ConversationWorkspace; entryKey: string }) {
  const entry = useConversationEntry(props.workspace, props.entryKey)
  renders.set(props.entryKey, (renders.get(props.entryKey) ?? 0) + 1)
  return (
    <output data-testid={props.entryKey}>{entry?.row.document.draft}</output>
  )
}

beforeEach(() => {
  renders.clear()
  useAuthStore.getState().auth.setUser({ id: 1, username: 'owner', role: 1 })
  vi.spyOn(pending, 'readPendingConversations').mockResolvedValue([])
  vi.spyOn(pending, 'writePendingConversation').mockResolvedValue()
  vi.spyOn(api, 'post').mockImplementation(async (_url, body) => {
    const write = JSON.parse(body as string) as { title: string }
    return {
      data: {
        success: true,
        data: {
          id: Math.floor(Math.random() * 1e6),
          title: write.title,
          revision: 1,
          create_time: 1,
          update_time: 1,
        },
      },
    }
  })
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  useAuthStore.getState().auth.reset()
})

it('re-renders only the component whose conversation changed', async () => {
  const workspace = new ConversationWorkspace(1, () => {})
  workspace.attach()
  const first = await workspace.create(emptyConversationDocument(), '', false)
  const second = await workspace.create(emptyConversationDocument(), '', false)
  assert(first && second)
  render(
    <>
      <Probe workspace={workspace} entryKey={first} />
      <Probe workspace={workspace} entryKey={second} />
    </>
  )
  const before = renders.get(first)
  act(() => {
    workspace.update(second, (row) => ({
      ...row,
      document: { ...row.document, draft: 'typed in the second' },
    }))
  })
  expect(screen.getByTestId(second)).toHaveTextContent('typed in the second')
  expect(renders.get(first)).toBe(before)
  expect(renders.get(second)).toBeGreaterThan(before ?? 0)
  workspace.dispose()
})
