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
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { toast } from 'sonner'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ConversationExportMenu } from '../components/conversation-export-menu'
import {
  emptyConversationDocument,
  type SavedConversation,
} from '../conversations-api'
import {
  exportConversation,
  downloadConversation,
} from '../lib/conversation-export'

function conversation(): SavedConversation {
  const document = emptyConversationDocument()
  document.draft = 'PRIVATE_DRAFT'
  document.config.model = 'PRIVATE_CONFIG'
  document.compression = {
    summary: 'PRIVATE_SUMMARY',
    boundary: 'first',
    sourceHash: 'hash',
    model: 'private',
    createdAt: 1,
  }
  document.messages = [
    {
      key: 'system',
      from: 'system',
      versions: [{ id: 's', content: 'Be helpful' }],
    },
    {
      key: 'first',
      from: 'user',
      createdAt: 1700000000000,
      versions: [
        { id: 'u', content: '你好\n\n![图片](https://example.com/image.png)' },
      ],
    },
    {
      key: 'reply',
      from: 'assistant',
      selectedVersionId: 'new',
      reasoning: { content: 'PRIVATE_REASONING', duration: 1 },
      versions: [
        { id: 'old', content: 'PRIVATE_OLD_REPLY' },
        {
          id: 'new',
          content:
            '## Answer\n\n```ts\nconst x = 1\n```\n\n| A | B |\n|---|---|\n| 1 | 2 |',
        },
      ],
    },
    {
      key: 'empty',
      from: 'assistant',
      versions: [{ id: 'empty', content: '  ' }],
    },
    {
      key: 'failed',
      from: 'assistant',
      status: 'error',
      versions: [
        { id: 'failed', content: 'Request error occurred: PRIVATE_FAILURE' },
      ],
    },
  ]
  return {
    id: 12,
    title: '中文/测试:会话?',
    revision: 1,
    create_time: 1700000000,
    update_time: 1700000001,
    document,
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('conversation export', () => {
  it('exports one Chatbox session with only the selected body, roles and timestamps', () => {
    const row = conversation()
    const file = exportConversation(
      row,
      'json',
      new Date('2026-10-16T12:00:00Z')
    )
    const backup = JSON.parse(file.content)
    expect(backup.configVersion).toBe(15)
    expect(backup['chat-sessions-list']).toHaveLength(1)
    const meta = backup['chat-sessions-list'][0]
    const session = backup[`session:${meta.id}`]
    expect(session.name).toBe(row.title)
    expect(meta.createdAt).toBe(1700000000000)
    expect(session.messages.map((m: { role: string }) => m.role)).toEqual([
      'system',
      'user',
      'assistant',
    ])
    expect(session.messages[1].timestamp).toBe(1700000000000)
    expect(session.messages[2].contentParts).toEqual([
      { type: 'text', text: row.document.messages[2].versions[1].content },
    ])
    expect(
      new Set(session.messages.map((m: { id: string }) => m.id)).size
    ).toBe(3)
    expect(
      JSON.parse(exportConversation(row, 'json').content)[
        'chat-sessions-list'
      ][0].id
    ).not.toBe(meta.id)
    expect(file.content).not.toContain('PRIVATE_')
    expect(Object.keys(backup).sort()).toEqual(
      [
        '__exported_at',
        'chat-sessions-list',
        'configVersion',
        `session:${meta.id}`,
      ].sort()
    )
    expect(file.filename).toBe('中文_测试_会话_-2026-10-16T12-00-00-000Z.json')
    expect(row.document.messages[2].versions).toHaveLength(2)
  })

  it('leaves a failed reply out of both formats', () => {
    const row = conversation()
    for (const format of ['json', 'md'] as const) {
      expect(exportConversation(row, format).content).not.toContain(
        'PRIVATE_FAILURE'
      )
    }
  })

  it('preserves Markdown bodies, code fences, tables and image links in order', () => {
    const row = conversation()
    const file = exportConversation(row, 'md')
    expect(file.content).toBe(
      `# ${row.title}\n\n## system\n\nBe helpful\n\n## user\n\n${row.document.messages[1].versions[0].content}\n\n## assistant\n\n${row.document.messages[2].versions[1].content}\n`
    )
    expect(file.content).not.toContain('PRIVATE_')
  })

  it('falls back for empty titles and missing selected versions without inventing content', () => {
    const row = conversation()
    row.title = ''
    row.document.messages = [
      {
        key: 'u',
        from: 'user',
        selectedVersionId: 'missing',
        versions: [{ id: 'first', content: 'first body' }],
      },
    ]
    expect(exportConversation(row, 'md').content).toBe(
      '# New conversation\n\n## user\n\nfirst body\n'
    )
    row.document.messages[0].versions = []
    expect(exportConversation(row, 'md').content).toBe('# New conversation\n')
  })

  it.each([true, false])(
    'disables export when busy=%s or no body exists',
    (busy) => {
      const row = conversation()
      if (!busy) row.document.messages = []
      render(<ConversationExportMenu conversation={row} busy={busy} />)
      expect(
        screen.getByRole('button', { name: 'Export conversation' })
      ).toBeDisabled()
    }
  )

  it('downloads JSON from the keyboard menu without needing a saved server ID', async () => {
    const create = vi.fn(() => 'blob:export')
    vi.stubGlobal(
      'URL',
      class extends URL {
        static createObjectURL = create
        static revokeObjectURL = vi.fn()
      }
    )
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => {})
    const row = conversation()
    row.id = 0
    render(<ConversationExportMenu conversation={row} busy={false} />)
    const user = userEvent.setup()
    screen.getByRole('button', { name: 'Export conversation' }).focus()
    await user.keyboard('{Enter}')
    const item = await screen.findByRole('menuitem', {
      name: 'JSON (Chatbox compatible)',
    })
    await waitFor(() => expect(item).toHaveFocus())
    await user.keyboard('{Enter}')
    await waitFor(() => expect(click).toHaveBeenCalledOnce())
    expect(create.mock.calls[0]).toHaveLength(1)
    expect(document.querySelector('a[download]')).toBeNull()
  })

  it('reports download failures rather than changing the conversation', async () => {
    vi.stubGlobal(
      'URL',
      class extends URL {
        static createObjectURL(): string {
          throw new Error('blocked')
        }
      }
    )
    const error = vi.spyOn(toast, 'error').mockImplementation(() => 'toast')
    render(
      <ConversationExportMenu conversation={conversation()} busy={false} />
    )
    fireEvent.click(screen.getByRole('button', { name: 'Export conversation' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Markdown' }))
    expect(error).toHaveBeenCalledWith('Failed to export conversation')
  })

  it('releases the download URL after an anchor failure', () => {
    vi.useFakeTimers()
    const revoke = vi.fn()
    vi.stubGlobal(
      'URL',
      class extends URL {
        static createObjectURL = () => 'blob:export'
        static revokeObjectURL = revoke
      }
    )
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {
      throw new Error('blocked')
    })
    try {
      expect(() => downloadConversation(conversation(), 'md')).toThrow(
        'blocked'
      )
      expect(document.querySelector('a[download]')).toBeNull()
      vi.runAllTimers()
      expect(revoke).toHaveBeenCalledWith('blob:export')
    } finally {
      vi.useRealTimers()
    }
  })
})
