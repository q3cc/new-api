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

/**
 * Provider tags for user groups. The API key group picker filters groups by
 * tag. A group's tag is the one an administrator assigned, or else it is
 * detected from the group's name and description.
 */
export type GroupTag = {
  /** Stored in the group_ratio_setting.group_tag option. */
  readonly id: string
  /** English label; only mixed and other are translated. */
  readonly label: string
  /** Lobe icon key; mixed and other have their own icons. */
  readonly icon?: string
  readonly keywords: readonly string[]
  readonly pattern?: RegExp
}

/** A group that serves several providers. */
export const MIXED_GROUP_TAG = 'mixed'
/** A group that matches no provider. */
export const OTHER_GROUP_TAG = 'other'

const PROVIDER_GROUP_TAGS: readonly GroupTag[] = [
  {
    id: 'claude',
    label: 'Claude',
    icon: 'Claude.Color',
    keywords: ['claude', 'anthropic', 'sonnet', 'opus', 'haiku'],
  },
  {
    id: 'chatgpt',
    label: 'ChatGPT',
    icon: 'OpenAI',
    keywords: ['chatgpt', 'openai', 'gpt', 'codex', 'sora', 'dall-e'],
  },
  {
    id: 'gemini',
    label: 'Gemini',
    icon: 'Gemini.Color',
    keywords: [
      'gemini',
      'google',
      'vertex',
      'antigravity',
      'nano-banana',
      'imagen',
      '谷歌',
      '反重力',
    ],
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    icon: 'DeepSeek.Color',
    keywords: ['deepseek'],
  },
  {
    id: 'grok',
    label: 'Grok',
    icon: 'Grok',
    keywords: ['grok', 'xai', 'x.ai'],
  },
  {
    id: 'qwen',
    label: 'Qwen',
    icon: 'Qwen.Color',
    keywords: ['qwen', 'tongyi', 'bailian', '通义', '千问', '百炼'],
  },
  {
    id: 'doubao',
    label: 'Doubao',
    icon: 'Doubao.Color',
    keywords: ['doubao', 'volcengine', 'seedance', 'seedream', '豆包', '火山'],
  },
  {
    id: 'zhipu',
    label: 'Zhipu',
    icon: 'Zhipu.Color',
    keywords: ['zhipu', 'bigmodel', 'glm', '智谱'],
  },
  {
    id: 'kimi',
    label: 'Kimi',
    icon: 'Moonshot',
    keywords: ['kimi', 'moonshot', '月之暗面'],
  },
  {
    id: 'minimax',
    label: 'MiniMax',
    icon: 'Minimax.Color',
    keywords: ['minimax', 'hailuo', '海螺'],
  },
  {
    id: 'kling',
    label: 'Kling',
    icon: 'Kling.Color',
    keywords: ['kling', '可灵', '快手'],
  },
  {
    id: 'midjourney',
    label: 'Midjourney',
    icon: 'Midjourney',
    keywords: ['midjourney'],
    pattern: /(?:^|[^a-z0-9])mj(?:$|[^a-z0-9])/,
  },
  { id: 'suno', label: 'Suno', icon: 'Suno', keywords: ['suno'] },
  {
    id: 'mistral',
    label: 'Mistral',
    icon: 'Mistral.Color',
    keywords: ['mistral', 'mixtral', 'codestral'],
  },
  {
    id: 'llama',
    label: 'Llama',
    icon: 'Meta.Color',
    keywords: ['llama', 'meta-ai'],
  },
  {
    id: 'perplexity',
    label: 'Perplexity',
    icon: 'Perplexity.Color',
    keywords: ['perplexity', 'sonar'],
  },
  {
    id: 'cohere',
    label: 'Cohere',
    icon: 'Cohere.Color',
    keywords: ['cohere', 'command-r'],
  },
  {
    id: 'yi',
    label: 'Yi',
    icon: 'Yi.Color',
    keywords: ['01.ai', '零一万物', 'yi-large', 'yi-lightning'],
  },
  {
    id: 'stepfun',
    label: 'StepFun',
    icon: 'Stepfun.Color',
    keywords: ['stepfun', '阶跃'],
  },
  {
    id: 'baichuan',
    label: 'Baichuan',
    icon: 'Baichuan.Color',
    keywords: ['baichuan', '百川'],
  },
  {
    id: 'hunyuan',
    label: 'Hunyuan',
    icon: 'Hunyuan.Color',
    keywords: ['hunyuan', '混元', '腾讯'],
  },
  {
    id: 'ernie',
    label: 'ERNIE',
    icon: 'Wenxin.Color',
    keywords: ['ernie', 'wenxin', '文心', '百度'],
  },
  {
    id: 'spark',
    label: 'Spark',
    icon: 'Spark.Color',
    keywords: ['spark', '讯飞', 'xfyun', '星火'],
  },
  { id: 'vidu', label: 'Vidu', icon: 'Vidu.Color', keywords: ['vidu'] },
  {
    id: 'jimeng',
    label: 'Jimeng',
    icon: 'Jimeng.Color',
    keywords: ['jimeng', '即梦'],
  },
  { id: 'runway', label: 'Runway', icon: 'Runway', keywords: ['runway'] },
  { id: 'luma', label: 'Luma', icon: 'Luma', keywords: ['luma'] },
  { id: 'pika', label: 'Pika', icon: 'Pika', keywords: ['pika'] },
  {
    id: 'flux',
    label: 'Flux',
    icon: 'Flux',
    keywords: ['flux', 'black forest'],
  },
  {
    id: 'stability',
    label: 'Stability',
    icon: 'Stability.Color',
    keywords: ['stability ai', 'stable diffusion', 'sdxl'],
  },
  {
    id: 'ideogram',
    label: 'Ideogram',
    icon: 'Ideogram',
    keywords: ['ideogram'],
  },
  {
    id: 'nvidia',
    label: 'NVIDIA',
    icon: 'Nvidia.Color',
    keywords: ['nvidia', 'nemotron'],
  },
  {
    id: 'mimo',
    label: 'MiMo',
    icon: 'XiaomiMiMo',
    keywords: ['mimo', 'xiaomi', '小米'],
  },
  {
    id: 'longcat',
    label: 'LongCat',
    icon: 'LongCat',
    keywords: ['longcat', '美团'],
  },
]

const MIXED_TAG: GroupTag = {
  id: MIXED_GROUP_TAG,
  label: 'Mixed',
  keywords: ['综合', '混合', '全模型', 'mixed', 'all-in-one'],
}

const OTHER_TAG: GroupTag = {
  id: OTHER_GROUP_TAG,
  label: 'Other',
  keywords: [],
}

/** Every tag an administrator can assign, providers first. */
export const GROUP_TAGS: readonly GroupTag[] = [
  ...PROVIDER_GROUP_TAGS,
  MIXED_TAG,
  OTHER_TAG,
]

const GROUP_TAGS_BY_ID = new Map(GROUP_TAGS.map((tag) => [tag.id, tag]))

function mentions(tag: GroupTag, text: string): boolean {
  return (
    tag.keywords.some((keyword) => text.includes(keyword)) ||
    Boolean(tag.pattern?.test(text))
  )
}

/**
 * Detects a group's tag from its name and description: the one provider they
 * mention, "mixed" when they mention several (or say so), otherwise "other".
 */
export function detectGroupTag(name: string, description?: string): string {
  const text = `${name} ${description ?? ''}`.toLowerCase()
  if (mentions(MIXED_TAG, text)) return MIXED_GROUP_TAG
  const matched = PROVIDER_GROUP_TAGS.filter((tag) => mentions(tag, text))
  if (matched.length === 0) return OTHER_GROUP_TAG
  if (matched.length > 1) return MIXED_GROUP_TAG
  return matched[0].id
}

/** The tag shown for a group: the assigned one when known, else detected. */
export function resolveGroupTag(
  name: string,
  description?: string,
  assigned?: string | null
): string {
  if (assigned && GROUP_TAGS_BY_ID.has(assigned)) return assigned
  return detectGroupTag(name, description)
}

/** The definition of a tag id; unknown ids read as "other". */
export function getGroupTag(id: string): GroupTag {
  return GROUP_TAGS_BY_ID.get(id) ?? OTHER_TAG
}

/**
 * A tag's display label. Provider labels are brand names and stay as they
 * are (a brand such as "Runway" can collide with an unrelated i18n key);
 * only "Mixed" and "Other" are translated.
 */
export function getGroupTagLabel(
  id: string,
  t: (key: string) => string
): string {
  const tag = getGroupTag(id)
  return tag.id === MIXED_GROUP_TAG || tag.id === OTHER_GROUP_TAG
    ? t(tag.label)
    : tag.label
}
