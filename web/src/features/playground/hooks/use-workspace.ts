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
import { useRef, useSyncExternalStore } from 'react'

import {
  isGeneratingDocument,
  type ConversationEntry,
  type ConversationWorkspace,
  type WorkspaceSnapshot,
} from '../lib/conversation-workspace'

/**
 * Reads one value from the workspace. The component re-renders only when
 * that value changes, so a reply streaming into another conversation does
 * not touch it. The selector must return a primitive or a stable reference.
 */
export function useWorkspaceSelector<T>(
  workspace: ConversationWorkspace,
  selector: (snapshot: WorkspaceSnapshot) => T
): T {
  return useSyncExternalStore(workspace.subscribe, () =>
    selector(workspace.getSnapshot())
  )
}

export function useConversationEntry(
  workspace: ConversationWorkspace,
  key: string
): ConversationEntry | undefined {
  return useWorkspaceSelector(workspace, (snapshot) => snapshot.entries[key])
}

/**
 * The entries as the conversation list shows them. Only a new or removed
 * conversation, a title, a server ID or a reply starting or ending re-renders
 * the list; the text of a reply does not.
 */
export function useListedEntries(
  workspace: ConversationWorkspace
): ConversationEntry[] {
  const listed = useRef<{ signature: string; entries: ConversationEntry[] }>(
    undefined
  )
  return useSyncExternalStore(workspace.subscribe, () => {
    const entries = Object.values(workspace.getSnapshot().entries)
    const signature = entries
      .map((entry) =>
        [
          entry.key,
          entry.row.id,
          entry.row.title,
          isGeneratingDocument(entry.row.document) ? 1 : 0,
        ].join('\t')
      )
      .join('\n')
    if (listed.current?.signature !== signature) {
      listed.current = { signature, entries }
    }
    return listed.current.entries
  })
}
