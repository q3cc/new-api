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
import i18next from 'i18next'
import { useRef, useState } from 'react'
import { toast } from 'sonner'

import {
  type HumanVerificationHandle,
  type HumanVerificationScene,
  opensOnSubmit,
  useHumanVerificationConfig,
} from '@/lib/human-verification'

/**
 * Hook for the human verification widget on protected forms. It covers every
 * provider the server can enforce (Turnstile, GeeTest, reCAPTCHA); the names
 * keep "turnstile" because the server reads the answer from that parameter.
 */
export function useTurnstile(
  scene?: HumanVerificationScene | HumanVerificationScene[]
) {
  const { provider, siteKey } = useHumanVerificationConfig(scene)
  const [turnstileToken, setTurnstileToken] = useState('')
  const verificationRef = useRef<HumanVerificationHandle>(null)

  const isTurnstileEnabled = provider !== null
  // GeeTest opens its challenge when the protected button is clicked, so the
  // button stays enabled before any answer exists.
  const opensOnClick = opensOnSubmit(provider)
  const turnstileReady =
    !isTurnstileEnabled || opensOnClick || Boolean(turnstileToken)

  /**
   * Validate if the human check is done when required
   */
  const validateTurnstile = (): boolean => {
    if (isTurnstileEnabled && !turnstileToken) {
      toast.info(
        i18next.t('Please wait a moment, human check is initializing...')
      )
      return false
    }
    return true
  }

  /**
   * The answer to send with a protected request: '' when no check is enabled,
   * or null when the request must not be sent (the visitor closed the
   * challenge, or a widget answer is not ready yet).
   */
  const requestTurnstileToken = async (): Promise<string | null> => {
    if (!isTurnstileEnabled) return ''
    if (opensOnClick) {
      return (await verificationRef.current?.execute()) ?? null
    }
    return validateTurnstile() ? turnstileToken : null
  }

  return {
    humanVerificationProvider: provider,
    isTurnstileEnabled,
    opensOnClick,
    turnstileReady,
    turnstileSiteKey: siteKey,
    turnstileToken,
    setTurnstileToken,
    validateTurnstile,
    requestTurnstileToken,
    verificationRef,
  }
}
