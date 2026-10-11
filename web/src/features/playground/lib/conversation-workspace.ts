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
import { isAxiosError } from 'axios'

import { useAuthStore } from '@/stores/auth-store'

import {
  deleteConversation,
  getConversation,
  importConversation,
  parseConversation,
  writeConversation,
  type ConversationDocument,
  type ConversationWrite,
  type SavedConversation,
} from '../conversations-api'
import {
  conversationTitleSource,
  generateConversationTitle,
} from './conversation-title'
import {
  clearImportedSource,
  readLegacySource,
  readPendingConversations,
  writePendingConversation,
  type PendingConversation,
} from './storage/pending-conversations'

export type ConversationEntry = {
  key: string
  row: SavedConversation
  localVersion: number
  dirty: boolean
  saving: boolean
  titleGenerating?: boolean
  error?: unknown
  pending?: ConversationWrite
  pendingVersion?: number
}
type Snapshot = {
  entries: Record<string, ConversationEntry>
  migrationError?: unknown
  cacheError?: unknown
  ready: boolean
}
export function interruptedDocument(
  document: ConversationDocument
): ConversationDocument {
  return {
    ...document,
    messages: document.messages.map((message) =>
      message.status === 'loading' || message.status === 'streaming'
        ? { ...message, status: 'interrupted', isReasoningStreaming: false }
        : message
    ),
  }
}

export class ConversationWorkspace {
  private snapshot: Snapshot = { entries: {}, ready: false }
  private listeners = new Set<() => void>()
  private controller = new AbortController()
  private timer: ReturnType<typeof setTimeout> | undefined
  private taskQueue: Promise<unknown> = Promise.resolve()
  private cacheQueue: Promise<unknown> = Promise.resolve()
  private stopped = false
  private stopHandlers = new Map<string, () => void>()
  private unsubscribeAuth?: () => void
  private mounts = 0
  private initialization?: Promise<void>
  private retryAfter = 0
  private lastScheduled = ''
  private leases = new Map<string, () => void>()
  private opening = new Map<number, Promise<string | undefined>>()
  private titleRequests = new Map<string, AbortController>()
  constructor(
    readonly owner: number,
    private onSaved: (row?: SavedConversation) => void
  ) {}
  attach() {
    this.mounts += 1
    this.unsubscribeAuth ??= useAuthStore.subscribe((state) => {
      if (state.auth.user?.id !== this.owner) this.dispose()
    })
    this.initialization ??= this.initialize()
    return () => {
      this.mounts -= 1
      queueMicrotask(() => {
        if (!this.mounts) this.dispose()
      })
    }
  }
  getSnapshot = () => this.snapshot
  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }
  isActive = () =>
    !this.stopped && useAuthStore.getState().auth.user?.id === this.owner
  private publish(patch: Partial<Snapshot>) {
    this.snapshot = { ...this.snapshot, ...patch }
    for (const listener of this.listeners) listener()
  }
  private setEntry(entry: ConversationEntry) {
    this.publish({ entries: { ...this.snapshot.entries, [entry.key]: entry } })
  }
  registerStop(key: string, stop: () => void) {
    this.stopHandlers.set(key, stop)
    return () => {
      this.stopHandlers.delete(key)
    }
  }
  private async claim(key: string): Promise<boolean> {
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
  private cache(entry: ConversationEntry) {
    const value: PendingConversation = {
      owner: this.owner,
      key: entry.key,
      row: entry.row,
      pending: entry.pending,
      pendingVersion: entry.pendingVersion,
      localVersion: entry.localVersion,
    }
    this.cacheQueue = this.cacheQueue
      .catch(() => {})
      .then(() =>
        writePendingConversation(
          this.owner,
          entry.key,
          entry.dirty ? value : undefined
        )
      )
      .catch((error: unknown) => {
        if (this.isActive()) this.publish({ cacheError: error })
      })
    return this.cacheQueue
  }
  async initialize() {
    try {
      const pending = await readPendingConversations(this.owner)
      if (!this.isActive()) return
      for (const saved of pending) {
        if (!(await this.claim(saved.key))) continue
        const row = parseConversation(saved.row)
        this.setEntry({
          key: saved.key,
          row: { ...row, document: interruptedDocument(row.document) },
          localVersion: saved.localVersion + 1,
          dirty: true,
          saving: false,
          pending: saved.pending,
          pendingVersion: saved.pendingVersion,
        })
      }
      this.schedule()
    } catch (error: unknown) {
      if (this.isActive()) this.publish({ cacheError: error })
    }
    await this.migrate()
    if (this.isActive()) this.publish({ ready: true })
  }
  async migrate() {
    if (navigator.locks) {
      await navigator.locks.request('playground-legacy-import', () =>
        this.importLegacy()
      )
    } else await this.importLegacy()
  }
  private async importLegacy() {
    if (!this.isActive()) return
    this.publish({ migrationError: undefined })
    try {
      const source = readLegacySource(this.owner)
      if (!source) return
      const result = await importConversation(source, this.controller.signal)
      if (!this.isActive()) return
      clearImportedSource(this.owner, source)
      if (!result.deleted) await this.open(result.conversation_id)
      this.onSaved()
    } catch (error: unknown) {
      if (this.isActive()) this.publish({ migrationError: error })
    }
  }
  open(id: number, reload = false): Promise<string | undefined> {
    const opening = this.opening.get(id)
    if (opening) return opening
    const task = this.loadConversation(id, reload).finally(() =>
      this.opening.delete(id)
    )
    this.opening.set(id, task)
    return task
  }
  private async loadConversation(
    id: number,
    reload: boolean
  ): Promise<string | undefined> {
    if (!this.isActive()) return
    const existing = Object.values(this.snapshot.entries).find(
      (entry) => entry.row.id === id
    )
    if (existing && !reload) return existing.key
    if (existing) {
      this.cancelTitle(existing.key)
      this.stopHandlers.get(existing.key)?.()
    }
    if (reload) await this.taskQueue.catch(() => {})
    const row = await getConversation(id, this.controller.signal)
    if (!this.isActive()) return
    const key = existing?.key ?? crypto.randomUUID()
    if (!(await this.claim(key))) return
    const entry: ConversationEntry = {
      key,
      row: { ...row, document: interruptedDocument(row.document) },
      localVersion: 0,
      dirty: false,
      saving: false,
    }
    // A reload discards pending edits only after fetching a valid replacement.
    this.setEntry(entry)
    await this.cache(entry)
    return key
  }
  async create(
    document: ConversationDocument,
    title = '',
    save = true
  ): Promise<string | undefined> {
    if (!this.isActive()) return
    const key = crypto.randomUUID()
    if (!(await this.claim(key))) return
    const entry: ConversationEntry = {
      key,
      row: {
        id: 0,
        title,
        revision: 0,
        create_time: Date.now(),
        update_time: Date.now(),
        document: title ? { ...document, titleGeneration: 'manual' } : document,
      },
      localVersion: save ? 1 : 0,
      dirty: save,
      saving: false,
    }
    this.setEntry(entry)
    if (save) await this.flush(key)
    return this.isActive() ? key : undefined
  }
  update(key: string, update: (row: SavedConversation) => SavedConversation) {
    const previous = this.snapshot.entries[key]
    if (!this.isActive() || !previous) return
    const row = update(previous.row)
    if (row === previous.row) return
    if (
      previous.row.document.messages.length &&
      !row.document.messages.length
    ) {
      this.cancelTitle(key)
    }
    if (!row.title && row.document.messages.length) {
      const first = row.document.messages.find(
        (message) => message.from === 'user'
      )
      row.title = [
        ...(first?.versions[0]?.content.trim().replaceAll(/\s+/g, ' ') ?? ''),
      ]
        .slice(0, 40)
        .join('')
    }
    const entry = {
      ...this.snapshot.entries[key],
      row,
      localVersion: previous.localVersion + 1,
      dirty: true,
    }
    this.setEntry(entry)
    void this.cache(entry)
    const wasPending = previous.row.document.messages.some(
      (message) =>
        message.status === 'loading' || message.status === 'streaming'
    )
    const isPending = row.document.messages.some(
      (message) =>
        message.status === 'loading' || message.status === 'streaming'
    )
    if (wasPending && !isPending && !entry.error) void this.flush(key)
    else this.schedule()
  }
  rename(key: string, title: string) {
    this.cancelTitle(key)
    this.update(key, (row) => ({
      ...row,
      title,
      document: { ...row.document, titleGeneration: 'manual' },
    }))
  }
  private cancelTitle(key: string) {
    this.titleRequests.get(key)?.abort()
    this.titleRequests.delete(key)
    const entry = this.snapshot.entries[key]
    if (entry?.titleGenerating) {
      this.setEntry({ ...entry, titleGenerating: false })
    }
  }
  async generateTitle(key: string, retry = false): Promise<void> {
    const entry = this.snapshot.entries[key]
    if (
      !this.isActive() ||
      !entry ||
      entry.error ||
      this.titleRequests.has(key)
    ) {
      return
    }
    const document = entry.row.document
    const state = document.titleGeneration
    if (!retry && state !== 'ready' && state !== 'awaiting_reply') return
    if (
      !document.config.model ||
      document.messages.some(
        (message) =>
          message.status === 'loading' || message.status === 'streaming'
      ) ||
      !conversationTitleSource(document)
    ) {
      return
    }
    if (
      !retry &&
      state === 'awaiting_reply' &&
      !document.messages.some(
        (message) =>
          message.from === 'assistant' &&
          message.status === 'complete' &&
          message.versions.at(-1)?.content.trim()
      )
    ) {
      return
    }
    const controller = new AbortController()
    this.titleRequests.set(key, controller)
    this.setEntry({ ...entry, titleGenerating: true })
    // Save the attempt before making a paid request. A conflicting device loses
    // the revision check; a refreshed page offers retry instead of charging again.
    this.update(key, (row) => ({
      ...row,
      document: { ...row.document, titleGeneration: 'requested' },
    }))
    try {
      if (
        !(await this.flush(key)) ||
        this.titleRequests.get(key) !== controller
      ) {
        return
      }
      const title = await generateConversationTitle(
        document,
        AbortSignal.any([
          controller.signal,
          this.controller.signal,
          AbortSignal.timeout(90000),
        ])
      )
      if (!this.isActive() || this.titleRequests.get(key) !== controller) return
      this.update(key, (row) => ({
        ...row,
        title,
        document: { ...row.document, titleGeneration: 'generated' },
      }))
      await this.flush(key)
    } catch {
      if (!this.isActive() || this.titleRequests.get(key) !== controller) return
      this.update(key, (row) => ({
        ...row,
        document: { ...row.document, titleGeneration: 'failed' },
      }))
      await this.flush(key)
    } finally {
      if (this.titleRequests.get(key) === controller) this.cancelTitle(key)
    }
  }
  private schedule() {
    if (this.timer || !this.isActive()) return
    this.timer = setTimeout(
      () => {
        this.timer = undefined
        const entries = Object.values(this.snapshot.entries).filter(
          (entry) => entry.dirty && !entry.error && !entry.saving
        )
        const entry =
          entries.find((item) => item.key !== this.lastScheduled) ?? entries[0]
        if (!entry) return
        this.lastScheduled = entry.key
        void this.flush(entry.key).finally(() => this.schedule())
      },
      Math.max(2000, this.retryAfter - Date.now())
    )
  }
  flush(key: string): Promise<boolean> {
    const version = this.snapshot.entries[key]?.localVersion ?? 0
    const task = this.taskQueue
      .catch(() => {})
      .then(() => this.save(key, version))
    this.taskQueue = task
    return task
  }
  private async save(key: string, version: number): Promise<boolean> {
    let entry = this.snapshot.entries[key]
    if (!this.isActive() || !entry) return false
    if (!entry.dirty) return true
    if (Date.now() < this.retryAfter) {
      this.schedule()
      return false
    }
    const write = entry.pending ?? {
      operation_id: crypto.randomUUID(),
      revision: entry.row.revision,
      title: entry.row.title,
      document: entry.row.document,
    }
    const sentVersion = entry.pendingVersion ?? entry.localVersion
    entry = {
      ...entry,
      pending: write,
      pendingVersion: sentVersion,
      saving: true,
      error: undefined,
    }
    this.setEntry(entry)
    await this.cache(entry)
    if (!this.isActive() || !this.snapshot.entries[key]) return false
    try {
      const saved = await writeConversation(
        entry.row.id || null,
        write,
        this.controller.signal
      )
      const current = this.snapshot.entries[key]
      if (!this.isActive() || !current) return false
      const dirty = current.localVersion !== sentVersion
      const next = {
        ...current,
        row: {
          ...saved,
          title: current.row.title,
          document: current.row.document,
        },
        dirty,
        saving: false,
        pending: undefined,
        pendingVersion: undefined,
        error: undefined,
      }
      this.setEntry(next)
      await this.cache(next)
      this.onSaved(next.row)
      if (dirty && sentVersion < version) return this.save(key, version)
      if (dirty) this.schedule()
      return true
    } catch (error: unknown) {
      if (!this.isActive()) return false
      const current = this.snapshot.entries[key]
      if (!current) return false
      this.setEntry({ ...current, saving: false, error })
      if (isAxiosError(error) && error.response?.status === 429) {
        const seconds = Number(error.response.headers['retry-after']) || 10
        this.retryAfter = Date.now() + Math.max(1, seconds) * 1000
        this.setEntry({ ...this.snapshot.entries[key], error: undefined })
        this.schedule()
      }
      await this.cache(this.snapshot.entries[key])
      return false
    }
  }
  async remove(key: string) {
    const entry = this.snapshot.entries[key]
    if (!this.isActive() || !entry) return
    this.cancelTitle(key)
    this.stopHandlers.get(key)?.()
    // Join prior writes so an in-flight first create cannot become an orphan.
    await this.taskQueue.catch(() => {})
    if (!this.isActive()) return
    if (!this.snapshot.entries[key].row.id && !(await this.flush(key))) {
      throw (
        this.snapshot.entries[key].error ??
        new Error('Failed to save conversation')
      )
    }
    const latest = this.snapshot.entries[key]
    if (latest.row.id) {
      await deleteConversation(latest.row.id, this.controller.signal)
    }
    if (!this.isActive()) return
    const entries = { ...this.snapshot.entries }
    delete entries[key]
    this.publish({ entries })
    await this.cache({ ...latest, dirty: false })
    this.leases.get(key)?.()
    this.leases.delete(key)
    this.onSaved()
  }
  dispose() {
    if (this.stopped) return
    for (const key of this.titleRequests.keys()) this.cancelTitle(key)
    for (const stop of this.stopHandlers.values()) stop()
    for (const entry of Object.values(this.snapshot.entries)) {
      if (entry.dirty) {
        void this.cache({
          ...entry,
          row: {
            ...entry.row,
            document: interruptedDocument(entry.row.document),
          },
        })
      }
    }
    this.stopped = true
    this.controller.abort()
    if (this.timer) clearTimeout(this.timer)
    this.unsubscribeAuth?.()
    void this.cacheQueue.finally(() => {
      for (const release of this.leases.values()) release()
      this.leases.clear()
    })
  }
}
