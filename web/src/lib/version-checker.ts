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
import { t } from 'i18next'
import { toast } from 'sonner'

/**
 * Stale-build update notification.
 *
 * When a new frontend deployment lands, browsers keep serving the previously
 * cached HTML and entry chunks to already-open tabs. Those tabs keep running
 * old code until the user hard-refreshes. This module polls the server for the
 * currently deployed entry assets and offers a refresh when they differ from
 * the ones this document loaded. Navigation requires an explicit user action.
 *
 * Detection compares the entry script URLs of the deployed `index.html` with
 * a snapshot of script URLs taken before the application mounts. Rsbuild embeds a content
 * hash in every emitted filename, so any deploy that changes code changes those
 * URLs. `build-id` metadata is honoured as an additional signal when the server
 * injects it into the HTML.
 */

const DEFAULT_CHECK_INTERVAL = 5 * 60 * 1000
const DEFAULT_INITIAL_DELAY = 30 * 1000
const INDEX_PATH = '/index.html'
const UPDATE_TOAST_ID = 'frontend-update'

export interface VersionCheckerConfig {
  /** How often to poll, in milliseconds. Defaults to 5 minutes. */
  checkInterval?: number
  /** Delay before the first poll, in milliseconds. Defaults to 30 seconds. */
  initialDelay?: number
  /** Serve the version probe from a different path. Defaults to `/index.html`. */
  indexPath?: string
  /**
   * Replace the page after a new deployment is detected. Injected in tests so
   * navigation can be asserted without driving jsdom's unimplemented one.
   */
  reload?: () => void | Promise<void>
  /**
   * Last-resort navigation used when `reload` rejects. Injectable for the same
   * reason as `reload`.
   */
  forceReload?: () => void
}

export interface VersionProbeResult {
  /** Whether the deployed build differs from the one this document loaded. */
  hasNewVersion: boolean
  /** What differed: entry assets, the build tag, or nothing. */
  reason: 'assets' | 'build-id' | 'none' | 'unavailable'
}

let pollTimer: ReturnType<typeof setInterval> | null = null
let initialTimer: ReturnType<typeof setTimeout> | null = null
let isChecking = false
let loadedEntries: string[] | null = null
let updateNotified = false
let generation = 0
let stopVisibilityWatch: (() => void) | null = null

export function extractEntryUrls(html: string): string[] {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  return getEntryUrls(doc)
}

export function extractBuildId(html: string): string | null {
  const metaMatch = html.match(
    /<meta\s+name=["']build-id["']\s+content=["']([^"']+)["']/i
  )
  if (metaMatch?.[1]) return metaMatch[1]
  const attrMatch = html.match(/data-build-rev=["']([^"']+)["']/i)
  return attrMatch?.[1] ?? null
}

function getEntryUrls(doc: Document): string[] {
  const scripts = [...doc.querySelectorAll('script[src]')]
  const urls: string[] = []
  for (const script of scripts) {
    const src = script.getAttribute('src')
    if (!src) continue
    if (!/\.(js|mjs)(\?|$)/.test(src)) continue
    urls.push(src)
  }
  return urls.sort()
}

function normalizeUrl(url: string): string {
  try {
    return new URL(url, document.baseURI).href
  } catch {
    return url
  }
}

/**
 * Compare the deployed entry assets against the ones this document loaded.
 */
export async function probeForNewVersion(
  indexPath: string = INDEX_PATH
): Promise<VersionProbeResult> {
  const baseline = (loadedEntries ??= getEntryUrls(document).map(normalizeUrl))
  let html: string
  try {
    // `no-store` bypasses the HTTP cache so a cached index.html cannot hide a
    // newer deployment.
    const response = await fetch(`${indexPath}?t=${Date.now()}`, {
      method: 'GET',
      cache: 'no-store',
      headers: { 'Cache-Control': 'no-cache, no-store, must-revalidate' },
    })
    if (!response.ok) {
      return { hasNewVersion: false, reason: 'unavailable' }
    }
    html = await response.text()
  } catch {
    return { hasNewVersion: false, reason: 'unavailable' }
  }

  const deployedBuildId = extractBuildId(html)
  const loadedBuildId =
    document.querySelector<HTMLMetaElement>('meta[name="build-id"]')?.content ??
    null
  if (deployedBuildId && loadedBuildId && deployedBuildId !== loadedBuildId) {
    return { hasNewVersion: true, reason: 'build-id' }
  }

  const deployedEntries = extractEntryUrls(html).map(normalizeUrl)
  if (deployedEntries.length === 0 || baseline.length === 0) {
    return { hasNewVersion: false, reason: 'unavailable' }
  }

  const deployed = new Set(deployedEntries)
  const loaded = new Set(baseline)
  const sameSize = deployed.size === loaded.size
  const sameEntries = sameSize && [...deployed].every((url) => loaded.has(url))
  if (sameEntries) {
    return { hasNewVersion: false, reason: 'none' }
  }
  return { hasNewVersion: true, reason: 'assets' }
}

/**
 * Drop anything the browser keeps that could serve the previous build again,
 * then replace the current history entry with a cache-busted URL.
 */
async function defaultReload(): Promise<void> {
  if (typeof caches !== 'undefined') {
    try {
      const names = await caches.keys()
      await Promise.all(names.map((name) => caches.delete(name)))
    } catch {
      // Cache API may be unavailable or blocked by the browser.
    }
  }

  if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
    try {
      const registrations = await navigator.serviceWorker.getRegistrations()
      await Promise.all(registrations.map((reg) => reg.unregister()))
    } catch {
      // Service workers are optional; a failure must not prevent the reload.
    }
  }

  const url = new URL(window.location.href)
  url.searchParams.set('_v', String(Date.now()))
  window.location.replace(url.toString())
}

async function runCheck(config: VersionCheckerConfig): Promise<void> {
  if (isChecking || updateNotified) return
  const currentGeneration = generation
  isChecking = true
  try {
    const result = await probeForNewVersion(config.indexPath)
    if (currentGeneration !== generation || !result.hasNewVersion) return
    updateNotified = true
    const reload = config.reload ?? defaultReload
    const forceReload = config.forceReload ?? (() => window.location.reload())
    toast.info(t('New version available'), {
      id: UPDATE_TOAST_ID,
      duration: Infinity,
      closeButton: true,
      action: {
        label: t('Refresh'),
        onClick: () => {
          if (currentGeneration !== generation) return
          void Promise.resolve().then(reload).catch(forceReload)
        },
      },
    })
  } finally {
    if (currentGeneration === generation) isChecking = false
  }
}

/**
 * Start polling for new deployments. Returns an idempotent stop function.
 */
export function startVersionChecker(
  config: VersionCheckerConfig = {}
): () => void {
  stopVersionChecker()
  loadedEntries = getEntryUrls(document).map(normalizeUrl)

  const interval = config.checkInterval ?? DEFAULT_CHECK_INTERVAL
  const initialDelay = config.initialDelay ?? DEFAULT_INITIAL_DELAY

  initialTimer = setTimeout(() => {
    initialTimer = null
    void runCheck(config)
  }, initialDelay)

  pollTimer = setInterval(() => {
    void runCheck(config)
  }, interval)

  // A tab that was in the background when the deploy landed should notice as
  // soon as the user comes back to it, not after the next poll tick.
  const onVisible = () => {
    if (document.visibilityState === 'visible') void runCheck(config)
  }
  document.addEventListener('visibilitychange', onVisible)
  stopVisibilityWatch = () => {
    document.removeEventListener('visibilitychange', onVisible)
  }

  return stopVersionChecker
}

export function stopVersionChecker(): void {
  generation += 1
  isChecking = false
  loadedEntries = null
  updateNotified = false
  toast.dismiss(UPDATE_TOAST_ID)
  if (initialTimer) {
    clearTimeout(initialTimer)
    initialTimer = null
  }
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
  if (stopVisibilityWatch) {
    stopVisibilityWatch()
    stopVisibilityWatch = null
  }
}

/** Run a probe immediately, bypassing the schedule. */
export async function checkVersionNow(
  config: VersionCheckerConfig = {}
): Promise<void> {
  await runCheck(config)
}
