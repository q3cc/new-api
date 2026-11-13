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
import { describe, expect, test } from 'vitest'

import {
  detectGroupTag,
  getGroupTag,
  getGroupTagLabel,
  resolveGroupTag,
} from '../group-tag'

describe('group tag detection', () => {
  test.each([
    ['Claude Code MAX-企业', '可扛高并发 可外接', 'claude'],
    ['aws-kiro', 'Opus 4.5 专属', 'claude'],
    ['ChatGPT-Plus', '', 'chatgpt'],
    ['codex-特价', undefined, 'chatgpt'],
    ['Gemini-特价-反重力', '反重力gemini', 'gemini'],
    ['特价分组', '反重力渠道', 'gemini'],
    ['DeepSeek 旧模型', '', 'deepseek'],
    ['grok-heavy', '', 'grok'],
    ['视频', '快手可灵', 'kling'],
    ['智谱', '', 'zhipu'],
    ['绘图', 'MJ 快速通道', 'midjourney'],
  ])('tags %s (%s) as %s', (name, description, expected) => {
    expect(detectGroupTag(name, description)).toBe(expected)
  })

  test('tags a group that mentions several providers as mixed', () => {
    expect(detectGroupTag('vip', 'Claude + GPT + Gemini')).toBe('mixed')
  })

  test('tags a group that calls itself mixed as mixed, whatever else it names', () => {
    expect(detectGroupTag('综合分组', '')).toBe('mixed')
    expect(detectGroupTag('claude', '全模型可用')).toBe('mixed')
  })

  test('tags a group that mentions no provider as other', () => {
    expect(detectGroupTag('default', 'Default group')).toBe('other')
    expect(detectGroupTag('mjx', '')).toBe('other')
  })
})

describe('group tag resolution', () => {
  test('uses the tag an administrator assigned over the detected one', () => {
    expect(resolveGroupTag('Claude Max', '', 'gemini')).toBe('gemini')
    expect(resolveGroupTag('Claude Max', '', 'other')).toBe('other')
  })

  test.each([undefined, null, '', 'not-a-tag'])(
    'falls back to detection when the assigned tag is %s',
    (assigned) => {
      expect(resolveGroupTag('Claude Max', '', assigned)).toBe('claude')
    }
  )

  test('reads an unknown tag id as other', () => {
    expect(getGroupTag('not-a-tag').id).toBe('other')
    expect(getGroupTag('claude').label).toBe('Claude')
  })
})

describe('niche provider tags', () => {
  test.each([
    ['Mistral-大杯', 'mistral'],
    ['Llama 3 通道', 'llama'],
    ['Perplexity Sonar', 'perplexity'],
    ['讯飞星火', 'spark'],
    ['文心一言', 'ernie'],
    ['混元', 'hunyuan'],
    ['即梦视频', 'jimeng'],
    ['Vidu 视频', 'vidu'],
    ['Runway Gen-3', 'runway'],
    ['Flux 绘图', 'flux'],
    ['小米 MiMo', 'mimo'],
    ['阶跃星辰', 'stepfun'],
  ])('tags %s as %s', (name, expected) => {
    expect(detectGroupTag(name, '')).toBe(expected)
  })

  test('does not read a plain word as a niche provider', () => {
    expect(detectGroupTag('高稳定性 stability', '')).toBe('other')
  })

  test('keeps a client or channel name from turning a provider group into mixed', () => {
    expect(detectGroupTag('Claude-Cursor', 'Cursor claude 满缓存')).toBe(
      'claude'
    )
  })
})

describe('getGroupTagLabel', () => {
  const t = (key: string) => `zh:${key}`

  test('keeps provider brand names untranslated', () => {
    expect(getGroupTagLabel('runway', t)).toBe('Runway')
    expect(getGroupTagLabel('claude', t)).toBe('Claude')
  })

  test('translates mixed and other', () => {
    expect(getGroupTagLabel('mixed', t)).toBe('zh:Mixed')
    expect(getGroupTagLabel('other', t)).toBe('zh:Other')
    expect(getGroupTagLabel('unknown-tag', t)).toBe('zh:Other')
  })
})
