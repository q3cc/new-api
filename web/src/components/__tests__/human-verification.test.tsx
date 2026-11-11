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
import { act, render, screen, waitFor } from '@testing-library/react'
import { createRef } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  captchaLanguage,
  GEETEST_SCRIPT_URL,
  type HumanVerificationHandle,
  RECAPTCHA_SCRIPT_URL,
  resolveHumanVerification,
} from '@/lib/human-verification'

import { HumanVerification } from '../human-verification'

// The widgets load real third-party scripts; tests intercept the <script>
// element and run its onload with a fake global instead.
function interceptScripts(onScript: (src: string) => void) {
  const original = document.head.appendChild.bind(document.head)
  return vi
    .spyOn(document.head, 'appendChild')
    .mockImplementation(<T extends Node>(node: T): T => {
      if (node instanceof HTMLScriptElement) {
        onScript(node.src)
        queueMicrotask(() => node.dispatchEvent(new Event('load')))
        return node
      }
      return original(node)
    })
}

// A stand-in for gt4.js in bind mode that lets a test fire its events.
function installFakeGeetest(
  onInit: (options: Record<string, unknown>) => void = () => undefined
) {
  const fake: {
    showCaptcha: ReturnType<typeof vi.fn<() => void>>
    validate: Record<string, string> | false
    ready?: () => void
    success?: () => void
    close?: () => void
    error?: (error?: unknown) => void
  } = { showCaptcha: vi.fn<() => void>(), validate: false }
  window.initGeetest4 = (options, callback) => {
    onInit(options)
    const captcha = {
      onReady: (handler: () => void) => ((fake.ready = handler), captcha),
      onSuccess: (handler: () => void) => ((fake.success = handler), captcha),
      onClose: (handler: () => void) => ((fake.close = handler), captcha),
      onError: (handler: (error?: unknown) => void) => (
        (fake.error = handler),
        captcha
      ),
      showCaptcha: fake.showCaptcha,
      getValidate: () => fake.validate as never,
      destroy: vi.fn(),
    }
    callback(captcha)
  }
  return fake
}

afterEach(() => {
  vi.restoreAllMocks()
  delete window.initGeetest4
  delete window.grecaptcha
  document.head.querySelectorAll('script').forEach((script) => script.remove())
})

describe('resolveHumanVerification', () => {
  it('selects GeeTest only when its captcha ID is present', () => {
    expect(
      resolveHumanVerification({
        human_verification_provider: 'geetest',
        geetest_captcha_id: 'captcha-id',
      })
    ).toEqual({ provider: 'geetest', siteKey: 'captcha-id' })
    expect(
      resolveHumanVerification({ human_verification_provider: 'geetest' })
    ).toEqual({ provider: null, siteKey: '' })
  })

  it('selects reCAPTCHA only when its site key is present', () => {
    expect(
      resolveHumanVerification({
        human_verification_provider: 'recaptcha',
        recaptcha_site_key: 'site',
      })
    ).toEqual({ provider: 'recaptcha', siteKey: 'site' })
    expect(
      resolveHumanVerification({ human_verification_provider: 'recaptcha' })
    ).toEqual({ provider: null, siteKey: '' })
  })

  it('keeps Turnstile working for servers that only report turnstile_check', () => {
    expect(
      resolveHumanVerification({
        turnstile_check: true,
        turnstile_site_key: 'ts',
      })
    ).toEqual({ provider: 'turnstile', siteKey: 'ts' })
  })

  it('reports no provider when nothing is enabled', () => {
    expect(resolveHumanVerification({ turnstile_check: false })).toEqual({
      provider: null,
      siteKey: '',
    })
    expect(resolveHumanVerification(null)).toEqual({
      provider: null,
      siteKey: '',
    })
  })

  it('respects granular scene switches and defaults', () => {
    const status = {
      human_verification_provider: 'geetest',
      geetest_captcha_id: 'captcha-id',
      human_verification_scenes: {
        login: false,
        register: true,
        redemption: true,
        lottery: false,
      },
    }
    expect(resolveHumanVerification(status, 'login')).toEqual({
      provider: null,
      siteKey: '',
    })
    expect(resolveHumanVerification(status, 'register')).toEqual({
      provider: 'geetest',
      siteKey: 'captcha-id',
    })
    expect(resolveHumanVerification(status, 'redemption')).toEqual({
      provider: 'geetest',
      siteKey: 'captcha-id',
    })
    expect(resolveHumanVerification(status, 'lottery')).toEqual({
      provider: null,
      siteKey: '',
    })
    expect(
      resolveHumanVerification(status, ['login', 'email_verification'])
    ).toEqual({
      provider: 'geetest',
      siteKey: 'captcha-id',
    })
  })
})

describe('captchaLanguage', () => {
  it.each([
    ['zhCN', 'zho', 'zh-CN'],
    ['zhTW', 'zho-tw', 'zh-TW'],
    ['en', 'eng', 'en'],
    ['fr', 'fra', 'fr'],
    ['ru', 'rus', 'ru'],
    ['ja', 'jpn', 'ja'],
    ['vi', 'eng', 'vi'],
    ['xx-unknown', 'eng', 'en'],
    [undefined, 'eng', 'en'],
  ])('maps %s to %s for GeeTest and %s for reCAPTCHA', (lang, gt, rc) => {
    expect(captchaLanguage(lang, 'geetest')).toBe(gt)
    expect(captchaLanguage(lang, 'recaptcha')).toBe(rc)
  })
})

describe('HumanVerification', () => {
  // Runs before any GeeTest test loads gt4.js: loadScript caches a script once
  // it has loaded, and forgets it again only after a failed load.
  it('shows an error when the GeeTest script cannot load', async () => {
    vi.spyOn(document.head, 'appendChild').mockImplementation(
      <T extends Node>(node: T): T => {
        queueMicrotask(() => node.dispatchEvent(new Event('error')))
        return node
      }
    )

    render(
      <HumanVerification
        provider='geetest'
        siteKey='captcha-id'
        onVerify={vi.fn()}
      />
    )

    expect(await screen.findByRole('alert')).toBeInTheDocument()
  })

  it('loads reCAPTCHA from recaptcha.net and passes its token on', async () => {
    const scripts: string[] = []
    interceptScripts((src) => {
      scripts.push(src)
      window.grecaptcha = {
        ready: (callback) => callback(),
        render: (_element, options) => {
          ;(options.callback as (token: string) => void)('recaptcha-token')
          return 0
        },
        reset: vi.fn(),
      }
    })
    const onVerify = vi.fn()

    render(
      <HumanVerification
        provider='recaptcha'
        siteKey='site-key'
        onVerify={onVerify}
      />
    )

    await waitFor(() =>
      expect(onVerify).toHaveBeenCalledWith('recaptcha-token')
    )
    expect(scripts).toHaveLength(1)
    expect(scripts[0].startsWith(RECAPTCHA_SCRIPT_URL)).toBe(true)
    expect(new URL(scripts[0]).host).toBe('www.recaptcha.net')
  })

  it('opens GeeTest v4 in bind mode only when execute() is called', async () => {
    const answer = {
      lot_number: 'lot-1',
      captcha_output: 'output-1',
      pass_token: 'pass-1',
      gen_time: '1794382000',
    }
    let config: Record<string, unknown> = {}
    const scripts: string[] = []
    const fake = installFakeGeetest((options) => {
      config = options
    })
    interceptScripts((src) => scripts.push(src))
    const ref = createRef<HumanVerificationHandle>()

    const { container } = render(
      <HumanVerification
        ref={ref}
        provider='geetest'
        siteKey='captcha-id'
        onVerify={vi.fn()}
      />
    )

    await waitFor(() => expect(fake.ready).toBeDefined())
    expect(scripts).toEqual([GEETEST_SCRIPT_URL])
    expect(new URL(scripts[0]).host).toBe('static.geetest.com')
    expect(config).toMatchObject({
      captchaId: 'captcha-id',
      product: 'bind',
      language: 'eng',
    })
    expect(fake.showCaptcha).not.toHaveBeenCalled()
    expect(container.textContent).toBe('')

    act(() => fake.ready?.())
    const solved = ref.current?.execute()
    expect(fake.showCaptcha).toHaveBeenCalledTimes(1)
    fake.validate = answer
    act(() => fake.success?.())
    expect(JSON.parse((await solved) as string)).toEqual(answer)

    const closed = ref.current?.execute()
    act(() => fake.close?.())
    expect(await closed).toBeNull()
  })

  it('resolves execute() with null before GeeTest is ready', async () => {
    const fake = installFakeGeetest()
    interceptScripts(() => undefined)
    const ref = createRef<HumanVerificationHandle>()

    render(
      <HumanVerification
        ref={ref}
        provider='geetest'
        siteKey='captcha-id'
        onVerify={vi.fn()}
      />
    )

    await waitFor(() => expect(fake.ready).toBeDefined())
    expect(await ref.current?.execute()).toBeNull()
    expect(fake.showCaptcha).not.toHaveBeenCalled()
  })

  it('shows an error when GeeTest reports one', async () => {
    const fake = installFakeGeetest()
    interceptScripts(() => undefined)
    const onExpire = vi.fn()

    render(
      <HumanVerification
        provider='geetest'
        siteKey='bad-id'
        onVerify={vi.fn()}
        onExpire={onExpire}
      />
    )

    await waitFor(() => expect(fake.error).toBeDefined())
    act(() => fake.error?.({ code: '60001' }))
    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(onExpire).toHaveBeenCalled()
  })
})
