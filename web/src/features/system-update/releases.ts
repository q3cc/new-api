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
import { z } from 'zod'

export const systemReleaseSchema = z.object({
  tag_name: z.string().trim().min(1),
  name: z.string().nullable().optional(),
  body: z.string().nullable().optional(),
  published_at: z.iso.datetime().nullable().optional(),
  prerelease: z.boolean(),
})

export type SystemRelease = z.infer<typeof systemReleaseSchema>

/** The repository whose GitHub releases this deployment follows. */
export const SYSTEM_RELEASE_REPO = 'q3cc/new-api'

/**
 * Every push to main publishes a release tagged main-YYYYMMDD-<sha> (see
 * service/systemupgrade). Such builds are ordered by their date.
 */
const buildTagPattern = /^main-(\d{8})-([\da-f]{7,40})$/

function parseBuildTag(value: string | null | undefined) {
  const match = value?.trim().match(buildTagPattern)
  return match ? { date: match[1], sha: match[2] } : null
}

type SystemVersion = {
  core: bigint[]
  stage: number
  sequence: bigint
  revision: bigint
}

const releaseStages: Record<string, number> = {
  alpha: 0,
  beta: 1,
  rc: 2,
  stable: 3,
  patch: 4,
}

/** Project tags include post-release patches and historical numeric revisions. */
export function parseSystemVersion(
  value: string | null | undefined
): SystemVersion | null {
  const match = value
    ?.trim()
    .match(
      /^v?(\d+(?:\.\d+){2,})(?:-(alpha|beta|rc|patch)(?:\.(\d+))?(?:-i18nfix\.(\d+))?)?(?:\+[\da-zA-Z.-]+)?$/
    )
  if (!match || (match[4] && match[2] !== 'rc')) return null

  const core = match[1].split('.').map((part) => BigInt(part))
  if (core.every((part) => part === 0n)) return null

  return {
    core,
    stage: releaseStages[match[2] ?? 'stable'],
    sequence: BigInt(match[3] ?? '0'),
    revision: BigInt(match[4] ?? '0'),
  }
}

export function compareSystemVersions(
  left: string | null | undefined,
  right: string | null | undefined
): -1 | 0 | 1 | null {
  const leftBuild = parseBuildTag(left)
  const rightBuild = parseBuildTag(right)
  if (leftBuild || rightBuild) {
    if (!leftBuild || !rightBuild) return null
    if (leftBuild.sha === rightBuild.sha) return 0
    if (leftBuild.date > rightBuild.date) return 1
    // The right side is the newest published build, so a different build from
    // the same day or earlier is older. This matches service/systemupgrade.
    return -1
  }

  const a = parseSystemVersion(left)
  const b = parseSystemVersion(right)
  if (!a || !b) return null

  for (let index = 0; index < Math.max(a.core.length, b.core.length); index++) {
    const leftPart = a.core[index] ?? 0n
    const rightPart = b.core[index] ?? 0n
    if (leftPart !== rightPart) return leftPart < rightPart ? -1 : 1
  }
  if (a.stage !== b.stage) return a.stage < b.stage ? -1 : 1
  if (a.sequence !== b.sequence) return a.sequence < b.sequence ? -1 : 1
  if (a.revision !== b.revision) return a.revision < b.revision ? -1 : 1
  return 0
}

const publishedReleaseSchema = systemReleaseSchema.extend({
  draft: z.boolean(),
})

/** The newest main build, or else the highest semantic version. */
export function selectLatestRelease(payload: unknown): SystemRelease | null {
  if (!Array.isArray(payload)) throw new Error('Unexpected release payload')

  let latestBuild: SystemRelease | null = null
  let latestVersion: SystemRelease | null = null
  let validPayload = payload.length === 0
  for (const item of payload) {
    const parsed = publishedReleaseSchema.safeParse(item)
    if (!parsed.success) continue
    validPayload = true
    const release = parsed.data
    if (release.draft) continue
    if (parseBuildTag(release.tag_name)) {
      if (!latestBuild || buildPublishedAfter(release, latestBuild)) {
        latestBuild = systemReleaseSchema.parse(release)
      }
      continue
    }
    if (!parseSystemVersion(release.tag_name)) continue
    if (
      !latestVersion ||
      compareSystemVersions(release.tag_name, latestVersion.tag_name) === 1
    ) {
      latestVersion = systemReleaseSchema.parse(release)
    }
  }
  if (!validPayload) throw new Error('Unexpected release payload')
  return latestBuild ?? latestVersion
}

// Several builds can share a date, so the publish time orders them.
function buildPublishedAfter(
  release: SystemRelease,
  current: SystemRelease
): boolean {
  const date = parseBuildTag(release.tag_name)?.date ?? ''
  const currentDate = parseBuildTag(current.tag_name)?.date ?? ''
  if (date !== currentDate) return date > currentDate
  return (release.published_at ?? '') > (current.published_at ?? '')
}

export function getSystemReleaseUrl(release: SystemRelease): string {
  return `https://github.com/${SYSTEM_RELEASE_REPO}/releases/tag/${encodeURIComponent(release.tag_name)}`
}
