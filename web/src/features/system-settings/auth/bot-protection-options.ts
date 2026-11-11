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
import * as z from 'zod'

export const BOT_PROTECTION_PROVIDERS = [
  'none',
  'turnstile',
  'geetest',
  'recaptcha',
] as const
export type BotProtectionChoice = (typeof BOT_PROTECTION_PROVIDERS)[number]

export const botProtectionSchema = z.object({
  provider: z.enum(BOT_PROTECTION_PROVIDERS),
  turnstileSiteKey: z.string(),
  turnstileSecretKey: z.string(),
  geetestCaptchaId: z.string(),
  geetestSecret: z.string(),
  recaptchaSiteKey: z.string(),
  recaptchaSecret: z.string(),
  loginEnabled: z.boolean(),
  registerEnabled: z.boolean(),
  emailVerificationEnabled: z.boolean(),
  resetPasswordEnabled: z.boolean(),
  checkinEnabled: z.boolean(),
  redemptionEnabled: z.boolean(),
  lotteryEnabled: z.boolean(),
})

export type BotProtectionFormValues = z.infer<typeof botProtectionSchema>

/** The options the Bot Protection section saves, by their server keys. */
export type BotProtectionOptions = {
  TurnstileCheckEnabled: boolean
  TurnstileSiteKey?: string
  TurnstileSecretKey?: string
  'human_verification.provider'?: string
  'human_verification.geetest_captcha_id'?: string
  'human_verification.geetest_secret'?: string
  'human_verification.recaptcha_site_key'?: string
  'human_verification.recaptcha_secret'?: string
  'human_verification.login_enabled'?: boolean
  'human_verification.register_enabled'?: boolean
  'human_verification.email_verification_enabled'?: boolean
  'human_verification.reset_password_enabled'?: boolean
  'human_verification.checkin_enabled'?: boolean
  'human_verification.redemption_enabled'?: boolean
  'human_verification.lottery_enabled'?: boolean
}

type OptionKey = keyof BotProtectionOptions
export type BotProtectionUpdate = [OptionKey, string | boolean]

const SCENE_DEFAULT_BY_KEY: Partial<Record<OptionKey, boolean>> = {
  'human_verification.login_enabled': true,
  'human_verification.register_enabled': true,
  'human_verification.email_verification_enabled': true,
  'human_verification.reset_password_enabled': true,
  'human_verification.checkin_enabled': true,
  'human_verification.redemption_enabled': false,
  'human_verification.lottery_enabled': false,
}

export function toBotProtectionFormValues(
  options: BotProtectionOptions
): BotProtectionFormValues {
  const saved = options['human_verification.provider']
  let provider: BotProtectionChoice = 'none'
  if (options.TurnstileCheckEnabled) provider = 'turnstile'
  else if (saved === 'geetest' || saved === 'recaptcha') provider = saved
  return {
    provider,
    turnstileSiteKey: options.TurnstileSiteKey ?? '',
    turnstileSecretKey: options.TurnstileSecretKey ?? '',
    geetestCaptchaId: options['human_verification.geetest_captcha_id'] ?? '',
    geetestSecret: options['human_verification.geetest_secret'] ?? '',
    recaptchaSiteKey: options['human_verification.recaptcha_site_key'] ?? '',
    recaptchaSecret: options['human_verification.recaptcha_secret'] ?? '',
    loginEnabled: options['human_verification.login_enabled'] ?? true,
    registerEnabled: options['human_verification.register_enabled'] ?? true,
    emailVerificationEnabled:
      options['human_verification.email_verification_enabled'] ?? true,
    resetPasswordEnabled:
      options['human_verification.reset_password_enabled'] ?? true,
    checkinEnabled: options['human_verification.checkin_enabled'] ?? true,
    redemptionEnabled:
      options['human_verification.redemption_enabled'] ?? false,
    lotteryEnabled: options['human_verification.lottery_enabled'] ?? false,
  }
}

const SWITCH_KEYS = new Set<OptionKey>([
  'TurnstileCheckEnabled',
  'human_verification.provider',
])

// The server never returns secrets, so an empty secret field means "keep it".
const SECRET_KEYS = new Set<OptionKey>([
  'TurnstileSecretKey',
  'human_verification.geetest_secret',
  'human_verification.recaptcha_secret',
])

/**
 * Lists the changed options in an order the server accepts one by one: turn
 * the old provider off first, save keys next, and turn the new provider on
 * last, once its keys are stored.
 */
export function buildBotProtectionUpdates(
  saved: BotProtectionOptions,
  values: BotProtectionFormValues
): BotProtectionUpdate[] {
  const humanProvider =
    values.provider === 'geetest' || values.provider === 'recaptcha'
      ? values.provider
      : ''
  const next: BotProtectionUpdate[] = [
    ['TurnstileCheckEnabled', values.provider === 'turnstile'],
    ['TurnstileSiteKey', values.turnstileSiteKey],
    ['TurnstileSecretKey', values.turnstileSecretKey],
    ['human_verification.provider', humanProvider],
    ['human_verification.geetest_captcha_id', values.geetestCaptchaId],
    ['human_verification.geetest_secret', values.geetestSecret],
    ['human_verification.recaptcha_site_key', values.recaptchaSiteKey],
    ['human_verification.recaptcha_secret', values.recaptchaSecret],
    ['human_verification.login_enabled', values.loginEnabled],
    ['human_verification.register_enabled', values.registerEnabled],
    [
      'human_verification.email_verification_enabled',
      values.emailVerificationEnabled,
    ],
    ['human_verification.reset_password_enabled', values.resetPasswordEnabled],
    ['human_verification.checkin_enabled', values.checkinEnabled],
    ['human_verification.redemption_enabled', values.redemptionEnabled],
    ['human_verification.lottery_enabled', values.lotteryEnabled],
  ]
  const changed = next.filter(([key, value]) => {
    if (SECRET_KEYS.has(key) && value === '') return false
    const previous =
      saved[key] ??
      SCENE_DEFAULT_BY_KEY[key] ??
      (key === 'TurnstileCheckEnabled' ? false : '')
    return value !== previous
  })
  const isSwitchOff = ([key, value]: BotProtectionUpdate) =>
    SWITCH_KEYS.has(key) && (value === false || value === '')
  return [
    ...changed.filter(isSwitchOff),
    ...changed.filter(([key]) => !SWITCH_KEYS.has(key)),
    ...changed.filter(
      (update) => SWITCH_KEYS.has(update[0]) && !isSwitchOff(update)
    ),
  ]
}
