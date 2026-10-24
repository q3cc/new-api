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
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { createInstance } from 'i18next'
import { expect, it } from 'vitest'

import en from '@/i18n/locales/en.json'
import fr from '@/i18n/locales/fr.json'
import ja from '@/i18n/locales/ja.json'
import ru from '@/i18n/locales/ru.json'
import vi from '@/i18n/locales/vi.json'
import zhTW from '@/i18n/locales/zh-TW.json'
import zh from '@/i18n/locales/zh.json'

import { renderAuditContent } from '../../lib/format'

async function translator(language: string, resources: typeof en) {
  const i18n = createInstance()
  await i18n.init({ lng: language, resources: { [language]: resources } })
  return i18n.t
}

// The actions the server's fallback audit records for administrator write
// routes, read from the route table itself so a new route cannot be missed.
const middlewareSource = readFileSync(
  resolve(import.meta.dirname, '../../../../../../middleware/audit.go'),
  'utf8'
)
const routeTableStart = middlewareSource.indexOf('var auditRouteActions')
const routeTable = middlewareSource.slice(
  routeTableStart,
  middlewareSource.indexOf('\n}\n', routeTableStart)
)
const fallbackActions = [
  ...new Set(
    [...routeTable.matchAll(/"[A-Z]+ [^"]+":\s*"([^"]+)"/g)].map(
      (match) => match[1]
    )
  ),
]

it('reads the server fallback actions, including routes added for activities and referral rebates', () => {
  expect(fallbackActions).toEqual(
    expect.arrayContaining([
      'activity.create',
      'activity.draw',
      'affiliate.rebate_approve',
      'task_plugin.upload',
    ])
  )
})

it.each([
  ['zh', zh],
  ['zh-TW', zhTW],
  ['fr', fr],
  ['ru', ru],
  ['ja', ja],
  ['vi', vi],
] as const)(
  'renders every server fallback action as a %s sentence instead of the raw route',
  async (language, resources) => {
    const english = await translator('en', en)
    const t = await translator(language, resources)
    const untranslated = fallbackActions.filter((action) => {
      const other = { op: { action, params: {} } }
      const text = renderAuditContent(other, t)
      return text === null || text === renderAuditContent(other, english)
    })

    expect(untranslated).toEqual([])
  }
)

it.each([
  ['vendor.merge', { target_vendor_id: 3 }, '合并了供应商'],
  [
    'subscription.user_plan_reset',
    { plan_id: 4, target_user_id: 9 },
    '重置了用户 9 在计划 4 下的生效中订阅',
  ],
  [
    'payment.epay_config_update',
    { endpoint_count: 1, payment_method_count: 2 },
    '更新了 Epay 配置',
  ],
])(
  'renders the %s action its handler records in Chinese',
  async (action, params, expected) => {
    const t = await translator('zh', zh)

    expect(renderAuditContent({ op: { action, params } }, t)).toBe(expected)
  }
)

it.each([
  ['payment.order_complete', { trade_no: 'T1' }, '为用户完成补单'],
  [
    'payment.epay_config_update',
    { endpoint_count: 1, payment_method_count: 2 },
    '更新了 Epay 配置',
  ],
])(
  'renders a %s operation older versions recorded as generic in Chinese',
  async (legacyAction, params, expected) => {
    const t = await translator('zh', zh)
    const other = {
      op: { action: 'generic', params: { action: legacyAction, ...params } },
    }

    expect(renderAuditContent(other, t)).toBe(expected)
  }
)
