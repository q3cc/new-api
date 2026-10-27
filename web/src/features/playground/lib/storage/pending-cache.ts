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
  SavedConversation,
} from '../../conversations-api'
import {
  readPendingConversations,
  writePendingConversation,
  type PendingConversation,
} from './pending-conversations'

/** The part of a workspace entry the cache keeps. */
export type CachedEntry = {
  key: string
  row: SavedConversation
  dirty: boolean
  localVersion: number
  pending?: ConversationWrite | ConversationPatch
  pendingVersion?: number
}

// Streaming replies update many times a second; the crash-recovery cache is
// written at most this often per conversation and at once when a reply ends.
const CACHE_DELAY = 1000

/**
 * The crash-recovery copy of unsaved conversations in IndexedDB, and the
 * lease that keeps two tabs from working on the same unsaved conversation.
 */
export class PendingCache {
  private queue: Promise<unknown> = Promise.resolve()
  private timers = new Map<string, ReturnType<typeof setTimeout>>()
  private leases = new Map<string, () => void>()
  constructor(
    private readonly owner: number,
    private readonly isActive: () => boolean,
    private readonly onError: (error: unknown) => void
  ) {}
  read(): Promise<PendingConversation[]> {
    return readPendingConversations(this.owner)
  }
  async claim(key: string): Promise<boolean> {
    if (this.leases.has(key) || !navigator.locks) return true
    return new Promise((resolve) => {
      void navigator.locks
        .request(
          `playground-pending:${this.owner}:${key}`,
          { ifAvailable: true },
          async (lock) => {
            if (!lock || !this.isActive()) {
              resolve(false)
              return
            }
            await new Promise<void>((release) => {
              this.leases.set(key, release)
              resolve(true)
            })
          }
        )
        .catch(() => resolve(false))
    })
  }
  /** Writes the entry soon, as the reader finds it by then. */
  writeLater(key: string, read: () => CachedEntry | undefined) {
    if (this.timers.has(key) || !this.isActive()) return
    this.timers.set(
      key,
      setTimeout(() => {
        this.timers.delete(key)
        const entry = read()
        if (entry) void this.write(entry)
      }, CACHE_DELAY)
    )
  }
  /** Writes the entry now; a dirty entry is kept, a clean one removed. */
  write(entry: CachedEntry): Promise<unknown> {
    const timer = this.timers.get(entry.key)
    if (timer) {
      clearTimeout(timer)
      this.timers.delete(entry.key)
    }
    const value: PendingConversation = {
      owner: this.owner,
      key: entry.key,
      row: entry.row,
      pending: entry.pending,
      pendingVersion: entry.pendingVersion,
      localVersion: entry.localVersion,
    }
    this.queue = this.queue
      .catch(() => {})
      .then(() =>
        writePendingConversation(
          this.owner,
          entry.key,
          entry.dirty ? value : undefined
        )
      )
      .catch((error: unknown) => {
        if (this.isActive()) this.onError(error)
      })
    return this.queue
  }
  release(key: string) {
    this.leases.get(key)?.()
    this.leases.delete(key)
  }
  /** Stops pending writes and lets go of every lease once writes are done. */
  dispose() {
    for (const timer of this.timers.values()) clearTimeout(timer)
    this.timers.clear()
    void this.queue.finally(() => {
      for (const release of this.leases.values()) release()
      this.leases.clear()
    })
  }
}
