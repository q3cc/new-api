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
import type { ModelCapability } from '../compression-api'
import type { SavedConversation } from '../conversations-api'
import { compressContext, validCompression } from './context-compression'
import type { ConversationEntry } from './conversation-entry'

/** What the coordinator needs from the workspace that owns the entries. */
export type CompressionHost = {
  isActive: () => boolean
  getEntry: (key: string) => ConversationEntry | undefined
  setEntry: (entry: ConversationEntry) => void
  update: (
    key: string,
    updater: (row: SavedConversation) => SavedConversation
  ) => void
  flush: (key: string) => Promise<boolean>
  cancelTitle: (key: string) => void
  /** Aborts every request when the workspace is disposed. */
  signal: AbortSignal
}

/**
 * Runs at most one compression per conversation: the attempt is saved before
 * the paid request, progress is reported on the entry, and the summary is
 * kept only if the conversation did not change meanwhile.
 */
export class CompressionCoordinator {
  private requests = new Map<string, AbortController>()
  constructor(private readonly host: CompressionHost) {}
  has(key: string): boolean {
    return this.requests.has(key)
  }
  cancel(key: string) {
    this.requests.get(key)?.abort()
    this.requests.delete(key)
    const entry = this.host.getEntry(key)
    if (entry?.compressionProgress) {
      this.host.setEntry({ ...entry, compressionProgress: undefined })
    }
  }
  cancelAll() {
    for (const key of this.requests.keys()) this.cancel(key)
  }
  async compress(
    key: string,
    capability: ModelCapability,
    group?: string,
    signal?: AbortSignal
  ): Promise<boolean> {
    const entry = this.host.getEntry(key)
    if (
      !this.host.isActive() ||
      !entry ||
      entry.error ||
      this.requests.has(key)
    ) {
      return false
    }
    this.host.cancelTitle(key)
    const controller = new AbortController()
    this.requests.set(key, controller)
    this.host.setEntry({
      ...entry,
      compressionProgress: { completed: 0, total: 0 },
      compressionError: undefined,
    })
    const document = entry.row.document
    this.host.update(key, (row) => ({
      ...row,
      document: { ...row.document, compressionAttempt: 'requested' },
    }))
    try {
      if (!(await this.host.flush(key))) return false
      const compression = await compressContext({
        document,
        capability,
        group,
        signal: AbortSignal.any([
          controller.signal,
          this.host.signal,
          ...(signal ? [signal] : []),
        ]),
        onProgress: (completed, total) => {
          const current = this.host.getEntry(key)
          if (
            this.host.isActive() &&
            current &&
            this.requests.get(key) === controller
          ) {
            this.host.setEntry({
              ...current,
              compressionProgress: { completed, total },
            })
          }
        },
      })
      const current = this.host.getEntry(key)
      if (
        !this.host.isActive() ||
        !current ||
        this.requests.get(key) !== controller
      ) {
        return false
      }
      if (!validCompression({ ...current.row.document, compression })) {
        throw new Error('Conversation changed during compression')
      }
      this.host.update(key, (row) => ({
        ...row,
        document: {
          ...row.document,
          compression,
          compressionAttempt: undefined,
        },
      }))
      return await this.host.flush(key)
    } catch (error) {
      const current = this.host.getEntry(key)
      if (
        this.host.isActive() &&
        current &&
        this.requests.get(key) === controller
      ) {
        this.host.setEntry({ ...current, compressionError: error })
        this.host.update(key, (row) => ({
          ...row,
          document: { ...row.document, compressionAttempt: 'failed' },
        }))
        await this.host.flush(key)
      }
      return false
    } finally {
      if (this.requests.get(key) === controller) {
        this.cancel(key)
      }
    }
  }
}
