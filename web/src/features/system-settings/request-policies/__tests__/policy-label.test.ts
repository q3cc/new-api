import { createInstance } from 'i18next'
import { expect, it } from 'vitest'

import en from '@/i18n/locales/en.json'
import zh from '@/i18n/locales/zh.json'

import { policyLabel } from '../policy-label'

it('explains automatic failover and replay limits in the selected language', async () => {
  const i18n = createInstance()
  await i18n.init({ lng: 'en', resources: { en, zh } })
  expect(policyLabel(i18n.t, 'automatic_disable')).toBe(
    'Retry after automatic disable'
  )
  expect(policyLabel(i18n.t, 'response_started')).toBe(
    'Response already started; retry stopped'
  )
  expect(policyLabel(i18n.t, 'request_cancelled')).toBe(
    'Request cancelled; retry stopped'
  )
  await i18n.changeLanguage('zh')
  expect(policyLabel(i18n.t, 'automatic_disable')).toBe('自动禁用后重试')
  expect(policyLabel(i18n.t, 'response_started')).toBe('响应已开始，停止重试')
  expect(policyLabel(i18n.t, 'request_cancelled')).toBe('请求已取消，停止重试')
})
