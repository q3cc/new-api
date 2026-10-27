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
import forge from 'node-forge'
import { expect, it } from 'vitest'

import { compressionSourceHash } from '../lib/context-compression'
import type { Message } from '../types'

// Summaries saved before this change carry hashes computed with node-forge;
// the replacement must produce the same digests or every saved summary would
// be discarded as stale.
function forgeHash(messages: Message[]): string {
  const digest = forge.md.sha256.create()
  for (const message of messages) {
    const item = forge.md.sha256.create()
    const version =
      message.versions.find((v) => v.id === message.selectedVersionId) ??
      message.versions[0]
    item.update(
      JSON.stringify([
        message.key,
        message.from,
        version.id,
        version.content,
        message.status,
      ]),
      'utf8'
    )
    digest.update(item.digest().toHex())
  }
  return digest.digest().toHex()
}

it('produces the same source hash as the node-forge implementation it replaces', () => {
  const messages: Message[] = [
    {
      key: 'q',
      from: 'user',
      versions: [{ id: 'v1', content: '你好，世界 😀 "quoted" \\ slash' }],
    },
    {
      key: 'a',
      from: 'assistant',
      status: 'complete',
      selectedVersionId: 'v2',
      versions: [
        { id: 'v1', content: 'first' },
        { id: 'v2', content: 'second answer' },
      ],
    },
  ]
  expect(compressionSourceHash(messages)).toBe(forgeHash(messages))
  expect(compressionSourceHash([])).toBe(forgeHash([]))
})
