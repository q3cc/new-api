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
import type {
  ConversationPatch,
  ConversationWrite,
  ImportProgress,
  SavedConversation,
} from '../conversations-api'

export type ConversationEntry = {
  key: string
  row: SavedConversation
  localVersion: number
  dirty: boolean
  /** The only unsaved change is the input draft; scheduled saves skip it. */
  draftOnly?: boolean
  saving: boolean
  titleGenerating?: boolean
  compressionProgress?: { completed: number; total: number }
  compressionError?: unknown
  error?: unknown
  /** Failed save attempts in a row; cleared once a save lands. */
  failures?: number
  /** When a save that failed on the network or the server is tried again. */
  retryAt?: number
  pending?: ConversationWrite | ConversationPatch
  pendingVersion?: number
  /**
   * The conversation as the server last confirmed it. While the messages are
   * still that array, a save sends only the fields that differ from it.
   */
  saved?: SavedConversation
}
export type WorkspaceSnapshot = {
  entries: Record<string, ConversationEntry>
  migrationError?: unknown
  migrationProgress?: ImportProgress
  cacheError?: unknown
  ready: boolean
}
