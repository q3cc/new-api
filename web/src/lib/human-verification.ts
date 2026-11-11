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
import { useStatus } from '@/hooks/use-status'

export type HumanVerificationProvider = 'turnstile' | 'geetest' | 'recaptcha'

export type HumanVerificationScene =
  | 'login'
  | 'register'
  | 'email_verification'
  | 'reset_password'
  | 'checkin'
  | 'redemption'
  | 'lottery'

export const HUMAN_VERIFICATION_SCENE_DEFAULTS: Record<
  HumanVerificationScene,
  boolean
> = {
  login: true,
  register: true,
  email_verification: true,
  reset_password: true,
  checkin: true,
  redemption: false,
  lottery: false,
}

/**
 * Imperative handle of a widget that opens on demand (GeeTest v4 in bind mode).
 * execute() shows the challenge and resolves with the answer, or with null when
 * the visitor closes it, it fails, or it is not loaded yet.
 */
export type HumanVerificationHandle = {
  execute: () => Promise<string | null>
}

/** Providers whose challenge opens when the protected button is clicked. */
export function opensOnSubmit(
  provider: HumanVerificationProvider | null
): boolean {
  return provider === 'geetest'
}

// Script URLs. GeeTest and reCAPTCHA use hosts reachable from mainland China:
// static.geetest.com (GeeTest v4), and www.recaptcha.net, which Google
// documents as the replacement for www.google.com (it loads its assets from
// www.gstatic.cn).
export const GEETEST_SCRIPT_URL = 'https://static.geetest.com/v4/gt4.js'
export const RECAPTCHA_SCRIPT_URL =
  'https://www.recaptcha.net/recaptcha/api.js?render=explicit'

const scriptLoads = new Map<string, Promise<void>>()

/** Loads a third-party script once; a failed load can be retried later. */
export function loadScript(src: string): Promise<void> {
  const pending = scriptLoads.get(src)
  if (pending) return pending
  const promise = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script')
    script.src = src
    script.async = true
    script.addEventListener('load', () => resolve(), { once: true })
    script.addEventListener(
      'error',
      () => {
        scriptLoads.delete(src)
        script.remove()
        reject(new Error(`Failed to load ${src}`))
      },
      { once: true }
    )
    document.head.appendChild(script)
  })
  scriptLoads.set(src, promise)
  return promise
}

/** Maps an interface language to the codes GeeTest and reCAPTCHA accept. */
export function captchaLanguage(
  language: string | undefined,
  provider: 'geetest' | 'recaptcha'
): string {
  const geetest = provider === 'geetest'
  switch (language) {
    case 'zh':
    case 'zhCN':
    case 'zh-CN':
      return geetest ? 'zho' : 'zh-CN'
    case 'zhTW':
    case 'zh-TW':
      return geetest ? 'zho-tw' : 'zh-TW'
    case 'fr':
      return geetest ? 'fra' : 'fr'
    case 'ru':
      return geetest ? 'rus' : 'ru'
    case 'ja':
      return geetest ? 'jpn' : 'ja'
    case 'vi':
      // GeeTest v4 has no Vietnamese interface.
      return geetest ? 'eng' : 'vi'
    default:
      return geetest ? 'eng' : 'en'
  }
}

type HumanVerificationStatus = {
  human_verification_provider?: string
  geetest_captcha_id?: string
  recaptcha_site_key?: string
  turnstile_check?: boolean
  turnstile_site_key?: string
  human_verification_scenes?: Partial<Record<HumanVerificationScene, boolean>>
} | null

function isSceneEnabledInStatus(
  status: HumanVerificationStatus,
  scene: HumanVerificationScene
): boolean {
  return (
    status?.human_verification_scenes?.[scene] ??
    HUMAN_VERIFICATION_SCENE_DEFAULTS[scene]
  )
}

/**
 * The provider the server enforces and the public key its widget needs (the
 * GeeTest captcha ID, or the reCAPTCHA or Turnstile site key). Older
 * servers report only turnstile_check, which still selects Turnstile.
 * When `scene` is provided, returns `{ provider: null, siteKey: '' }` if none
 * of the requested scenes are enabled.
 */
export function resolveHumanVerification(
  status: HumanVerificationStatus,
  scene?: HumanVerificationScene | HumanVerificationScene[]
): {
  provider: HumanVerificationProvider | null
  siteKey: string
} {
  if (scene !== undefined) {
    const scenes = Array.isArray(scene) ? scene : [scene]
    const anyEnabled = scenes.some((item) =>
      isSceneEnabledInStatus(status, item)
    )
    if (!anyEnabled) {
      return { provider: null, siteKey: '' }
    }
  }
  const reported = status?.human_verification_provider
  if (reported === 'geetest') {
    return status?.geetest_captcha_id
      ? { provider: 'geetest', siteKey: status.geetest_captcha_id }
      : { provider: null, siteKey: '' }
  }
  if (reported === 'recaptcha') {
    return status?.recaptcha_site_key
      ? { provider: 'recaptcha', siteKey: status.recaptcha_site_key }
      : { provider: null, siteKey: '' }
  }
  if (
    (reported === 'turnstile' || !reported) &&
    status?.turnstile_check &&
    status.turnstile_site_key
  ) {
    return { provider: 'turnstile', siteKey: status.turnstile_site_key }
  }
  return { provider: null, siteKey: '' }
}

export function isHumanVerificationSceneEnabled(
  status: HumanVerificationStatus,
  scene: HumanVerificationScene
): boolean {
  return resolveHumanVerification(status, scene).provider !== null
}

export function useHumanVerificationConfig(
  scene?: HumanVerificationScene | HumanVerificationScene[]
) {
  const { status } = useStatus()
  return resolveHumanVerification(status, scene)
}
