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
import {
  type Ref,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import {
  captchaLanguage,
  GEETEST_SCRIPT_URL,
  type HumanVerificationHandle,
  type HumanVerificationProvider,
  loadScript,
  RECAPTCHA_SCRIPT_URL,
} from '@/lib/human-verification'

import { Turnstile } from './turnstile'

type GeetestValidate = {
  lot_number: string
  captcha_output: string
  pass_token: string
  gen_time: string
}

type GeetestCaptcha = {
  onReady: (callback: () => void) => GeetestCaptcha
  onSuccess: (callback: () => void) => GeetestCaptcha
  onError: (callback: (error?: unknown) => void) => GeetestCaptcha
  onClose: (callback: () => void) => GeetestCaptcha
  showCaptcha: () => void
  getValidate: () => GeetestValidate | false
  destroy?: () => void
}

declare global {
  interface Window {
    initGeetest4?: (
      config: Record<string, unknown>,
      callback: (captcha: GeetestCaptcha) => void
    ) => void
    grecaptcha?: {
      ready: (callback: () => void) => void
      render: (element: HTMLElement, options: Record<string, unknown>) => number
      reset: (widgetId?: number) => void
    }
  }
}

type WidgetProps = {
  siteKey: string
  onVerify: (token: string) => void
  onExpire?: () => void
}

// GeeTest v4 runs in bind mode: nothing is shown until the form calls
// execute() from its submit handler, which opens the challenge in a popup.
function GeetestWidget(
  props: WidgetProps & { ref?: Ref<HumanVerificationHandle> }
) {
  const { t, i18n } = useTranslation()
  const [failed, setFailed] = useState(false)
  const captchaRef = useRef<GeetestCaptcha | null>(null)
  const readyRef = useRef(false)
  const pendingRef = useRef<((answer: string | null) => void) | null>(null)
  const onExpire = useRef(props.onExpire)
  onExpire.current = props.onExpire
  const language = captchaLanguage(
    i18n.resolvedLanguage || i18n.language,
    'geetest'
  )

  useImperativeHandle(props.ref, () => ({
    execute: () => {
      const captcha = captchaRef.current
      if (!captcha || !readyRef.current) {
        toast.info(t('Please wait a moment, human check is initializing...'))
        return Promise.resolve(null)
      }
      pendingRef.current?.(null)
      return new Promise<string | null>((resolve) => {
        pendingRef.current = resolve
        captcha.showCaptcha()
      })
    },
  }))

  useEffect(() => {
    let cancelled = false
    let captcha: GeetestCaptcha | null = null
    const settle = (answer: string | null) => {
      const resolve = pendingRef.current
      pendingRef.current = null
      resolve?.(answer)
    }
    setFailed(false)
    readyRef.current = false
    loadScript(GEETEST_SCRIPT_URL)
      .then(() => {
        if (cancelled) return
        if (!window.initGeetest4) throw new Error('initGeetest4')
        window.initGeetest4(
          {
            captchaId: props.siteKey,
            product: 'bind',
            hideSuccess: true,
            language,
            protocol: 'https://',
          },
          (instance) => {
            if (cancelled) {
              instance.destroy?.()
              return
            }
            captcha = instance
            captchaRef.current = instance
            instance
              .onReady(() => {
                readyRef.current = true
              })
              .onSuccess(() => {
                const answer = instance.getValidate()
                settle(answer ? JSON.stringify(answer) : null)
              })
              .onClose(() => settle(null))
              .onError(() => {
                settle(null)
                onExpire.current?.()
                setFailed(true)
              })
          }
        )
      })
      .catch(() => {
        if (!cancelled) setFailed(true)
      })
    return () => {
      cancelled = true
      settle(null)
      captchaRef.current = null
      readyRef.current = false
      captcha?.destroy?.()
    }
  }, [props.siteKey, language])

  if (!failed) return null
  return (
    <p role='alert' className='text-destructive text-sm'>
      {t(
        'Human verification is temporarily unavailable. Please try again later.'
      )}
    </p>
  )
}

function RecaptchaWidget(props: WidgetProps) {
  const { t, i18n } = useTranslation()
  const ref = useRef<HTMLDivElement | null>(null)
  const [failed, setFailed] = useState(false)
  const onVerify = useRef(props.onVerify)
  const onExpire = useRef(props.onExpire)
  onVerify.current = props.onVerify
  onExpire.current = props.onExpire
  const language = captchaLanguage(
    i18n.resolvedLanguage || i18n.language,
    'recaptcha'
  )

  useEffect(() => {
    let cancelled = false
    setFailed(false)
    const container = ref.current
    loadScript(`${RECAPTCHA_SCRIPT_URL}&hl=${language}`)
      .then(() => {
        const grecaptcha = window.grecaptcha
        if (!grecaptcha) throw new Error('grecaptcha')
        grecaptcha.ready(() => {
          if (cancelled || !container) return
          // render() needs an empty element; a fresh child keeps remounts safe.
          const target = document.createElement('div')
          container.replaceChildren(target)
          grecaptcha.render(target, {
            sitekey: props.siteKey,
            hl: language,
            callback: (token: string) => onVerify.current(token),
            'expired-callback': () => onExpire.current?.(),
            'error-callback': () => {
              onExpire.current?.()
              setFailed(true)
            },
          })
        })
      })
      .catch(() => {
        if (!cancelled) setFailed(true)
      })
    return () => {
      cancelled = true
      container?.replaceChildren()
    }
  }, [props.siteKey, language])

  return (
    <div>
      <div ref={ref} className='min-h-[78px]' />
      {failed && (
        <p role='alert' className='text-destructive mt-2 text-sm'>
          {t(
            'Human verification is temporarily unavailable. Please try again later.'
          )}
        </p>
      )}
    </div>
  )
}

type HumanVerificationProps = WidgetProps & {
  provider: HumanVerificationProvider
  className?: string
  /** Set for GeeTest, whose challenge opens through execute(). */
  ref?: Ref<HumanVerificationHandle>
}

/**
 * Renders the active human verification widget. onVerify receives the value
 * the server checks in the `turnstile` query parameter: the Turnstile or
 * reCAPTCHA token, or GeeTest v4's getValidate() result as JSON. siteKey is
 * the GeeTest captcha ID or the reCAPTCHA / Turnstile site key.
 *
 * Turnstile and reCAPTCHA show their widget and report the answer through
 * onVerify. GeeTest shows nothing until the form calls ref.execute(), which
 * opens the challenge and resolves with the answer. Remount it with
 * a new key to start a fresh challenge after each protected request.
 */
export function HumanVerification(props: HumanVerificationProps) {
  if (props.provider === 'geetest') {
    return (
      <div className={props.className}>
        <GeetestWidget {...props} />
      </div>
    )
  }
  if (props.provider === 'recaptcha') {
    return (
      <div className={props.className}>
        <RecaptchaWidget {...props} />
      </div>
    )
  }
  return (
    <Turnstile
      siteKey={props.siteKey}
      onVerify={props.onVerify}
      onExpire={props.onExpire}
      className={props.className}
    />
  )
}
