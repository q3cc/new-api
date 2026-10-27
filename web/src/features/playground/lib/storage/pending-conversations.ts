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
  LegacySource,
  SavedConversation,
} from '../../conversations-api'

export type PendingConversation = {
  owner: number
  key: string
  row: SavedConversation
  pending?: ConversationWrite | ConversationPatch
  pendingVersion?: number
  localVersion: number
}
const databaseName = 'new-api-playground-pending'
const unavailable = 'Unable to keep unsaved conversations on this device'

// One connection serves every read and write; it is dropped when the browser
// closes it or another tab upgrades the database, and reopened on demand.
let database: Promise<IDBDatabase> | undefined

function openDatabase(): Promise<IDBDatabase> {
  if (database) return database
  const opening: Promise<IDBDatabase> = new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1)
    request.addEventListener('upgradeneeded', () =>
      request.result.createObjectStore('pending', { keyPath: ['owner', 'key'] })
    )
    request.addEventListener('success', () => {
      const db = request.result
      const forget = () => {
        if (database === opening) database = undefined
      }
      db.addEventListener('close', forget)
      db.addEventListener('versionchange', () => {
        forget()
        db.close()
      })
      resolve(db)
    })
    request.addEventListener('error', () => {
      if (database === opening) database = undefined
      reject(new Error(unavailable))
    })
  })
  database = opening
  return opening
}

export async function readPendingConversations(
  owner: number
): Promise<PendingConversation[]> {
  const db = await openDatabase()
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('pending', 'readonly')
    const request = transaction
      .objectStore('pending')
      .getAll(IDBKeyRange.bound([owner, ''], [owner, '\uffff']))
    request.addEventListener('success', () =>
      resolve(request.result as PendingConversation[])
    )
    request.addEventListener('error', () =>
      reject(new Error('Unable to read unsaved conversations'))
    )
  })
}

export async function writePendingConversation(
  owner: number,
  key: string,
  value?: PendingConversation
): Promise<void> {
  const db = await openDatabase()
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction('pending', 'readwrite')
    const store = transaction.objectStore('pending')
    if (value) store.put(value)
    else store.delete([owner, key])
    transaction.addEventListener('complete', () => resolve())
    transaction.addEventListener('error', () => reject(new Error(unavailable)))
    transaction.addEventListener('abort', () => reject(new Error(unavailable)))
  })
}

const legacyKeys = {
  messages: 'playground_messages',
  config: 'playground_config',
  parameter_enabled: 'playground_parameter_enabled',
} as const
const ownerKey = 'playground_legacy_owner'

export function readLegacySource(owner: number): LegacySource | null {
  const bound = localStorage.getItem(ownerKey)
  if (bound && bound !== String(owner)) return null
  const source: LegacySource = {
    messages: localStorage.getItem(legacyKeys.messages),
    config: localStorage.getItem(legacyKeys.config),
    parameter_enabled: localStorage.getItem(legacyKeys.parameter_enabled),
  }
  if (Object.values(source).every((value) => value === null)) return null
  localStorage.setItem(ownerKey, String(owner))
  return source
}

export function clearImportedSource(owner: number, source: LegacySource): void {
  if (localStorage.getItem(ownerKey) !== String(owner)) return
  for (const field of Object.keys(legacyKeys) as (keyof LegacySource)[]) {
    if (localStorage.getItem(legacyKeys[field]) === source[field]) {
      localStorage.removeItem(legacyKeys[field])
    }
  }
  // Keep the owner marker while any legacy writer still has this origin open.
}
