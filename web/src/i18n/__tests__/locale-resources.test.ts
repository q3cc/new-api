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

import { createInstance } from 'i18next'
import { describe, expect, it } from 'vitest'

import en from '../locales/en.json'
import fr from '../locales/fr.json'
import ja from '../locales/ja.json'
import ru from '../locales/ru.json'
import vi from '../locales/vi.json'
import zhTW from '../locales/zh-TW.json'
import zhCN from '../locales/zh.json'

const resources = { en, fr, ja, ru, vi, zhCN, zhTW }
const trialKeys = [
  'Trial credit kinds',
  'Add trial credit kind',
  'Invitation reward kind',
  'Trial credit kind',
  'Available credit',
  'No trial credit kinds available',
  'Trial credit',
  'Trial group',
  'AFF rewards as trial credit',
  'Validity (days, 0 = never expires)',
  'Grant trial credit',
  'Invalid expiration time',
  'Never expires',
  'Waived',
  'e.g., SiAlipay, usdt',
  'Use usdt for the USDT logo. Leave empty to use the default icon.',
] as const

describe('loaded interface translations', () => {
  it.each(Object.keys(resources) as Array<keyof typeof resources>)(
    '%s keeps all translations in the namespace loaded by the interface',
    (language) => {
      expect(Object.keys(resources[language])).toEqual(['translation'])
      const translations: Record<string, string> =
        resources[language].translation
      for (const key of trialKeys) {
        expect(translations[key]).toEqual(expect.any(String))
      }
    }
  )

  it.each([
    ['zhCN', '体验金', '体验分组', '发放体验金'],
    ['zhTW', '體驗金', '體驗分組', '發放體驗金'],
  ] as const)(
    '%s renders the trial credit menu and page labels in Chinese',
    async (language, title, group, grant) => {
      const i18n = createInstance()
      await i18n.init({
        resources,
        lng: language,
        fallbackLng: 'en',
        nsSeparator: false,
      })
      expect(i18n.t('Trial credit')).toBe(title)
      expect(i18n.t('Trial group')).toBe(group)
      expect(i18n.t('Grant trial credit')).toBe(grant)
      expect(i18n.t('AFF rewards as trial credit')).not.toBe(
        'AFF rewards as trial credit'
      )
      expect(i18n.t('Validity (days, 0 = never expires)')).not.toBe(
        'Validity (days, 0 = never expires)'
      )
      expect(
        i18n.t(
          'Use usdt for the USDT logo. Leave empty to use the default icon.'
        )
      ).not.toBe(
        'Use usdt for the USDT logo. Leave empty to use the default icon.'
      )
    }
  )

  it('switching from English to simplified and traditional Chinese reloads the trial credit label', async () => {
    const i18n = createInstance()
    await i18n.init({
      resources,
      lng: 'en',
      fallbackLng: 'en',
      nsSeparator: false,
    })
    expect(i18n.t('Trial credit')).toBe('Trial credit')
    await i18n.changeLanguage('zhCN')
    expect(i18n.t('Trial credit')).toBe('体验金')
    await i18n.changeLanguage('zhTW')
    expect(i18n.t('Trial credit')).toBe('體驗金')
  })
})
