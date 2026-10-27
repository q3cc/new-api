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
'use client'

import { memo, useLayoutEffect, useMemo, useRef } from 'react'
import { getMarkdown, parseMarkdownToStructure } from 'stream-markdown-parser'

import { cn } from '@/lib/utils'

import { getMarkdownContent, parseResponseContent } from './response-content'
import {
  beginRun,
  commitRun,
  createFadeState,
  FADE_HYDRATION_THRESHOLD,
  stageRun,
  type FadeRun,
  type FadeState,
} from './response-fade'
import { renderChildren, renderFootnotes } from './response-renderer'
import type { ResponseProps } from './response-types'

const DEFAULT_PARSER_ID = 'new-api-response'
// Beyond this length the per-word fade costs more each frame than it shows,
// so long replies stream without it while keeping their Markdown.
const MAX_ANIMATED_MARKDOWN_CHARS = 20_000
// Each streaming message keeps its own parser so appends reuse the nodes it
// already settled; the least recently used ones are dropped past this count.
const MAX_CACHED_PARSERS = 64
type MarkdownInstance = ReturnType<typeof getMarkdown>

const markdownByParserId = new Map<string, MarkdownInstance>()

function getCachedMarkdown(parserId: string): MarkdownInstance {
  const cached = markdownByParserId.get(parserId)
  if (cached != null) {
    // Re-insert so the map's order reflects recent use.
    markdownByParserId.delete(parserId)
    markdownByParserId.set(parserId, cached)
    return cached
  }
  const markdown = getMarkdown(parserId)
  markdownByParserId.set(parserId, markdown)
  while (markdownByParserId.size > MAX_CACHED_PARSERS) {
    const oldest = markdownByParserId.keys().next().value
    if (oldest === undefined) break
    markdownByParserId.delete(oldest)
  }
  return markdown
}

export const Response = memo((props: ResponseProps) => {
  const content = useMemo(
    () => getMarkdownContent(props.children),
    [props.children]
  )
  const isFinal = props.final ?? true
  const shouldAnimate = !isFinal
  const parserId = props.parserId ?? DEFAULT_PARSER_ID
  const markdown = getCachedMarkdown(parserId)
  const fadeStateRef = useRef<FadeState | null>(null)
  if (fadeStateRef.current == null) {
    fadeStateRef.current = createFadeState()
  }

  const nodes = useMemo(() => {
    if (isFinal) {
      return parseMarkdownToStructure(content, markdown, {
        final: true,
        validateLink: markdown.options.validateLink,
      })
    }
    // A stream only appends, so the top-level nodes that were already
    // complete are reused instead of parsed again on every token.
    return parseMarkdownToStructure(content, markdown, {
      final: false,
      validateLink: markdown.options.validateLink,
      reuseStableTopLevelNodes: true,
      parserMetrics: {},
    })
  }, [content, isFinal, markdown])
  const parsedContent = useMemo(() => parseResponseContent(nodes), [nodes])

  let fadeRun: FadeRun | undefined
  let renderedContent
  let footnotes

  if (parsedContent.bodyNodes.length > 0) {
    if (shouldAnimate) {
      const fadeState = fadeStateRef.current
      const suppress =
        (fadeState.firstRun && content.length > FADE_HYDRATION_THRESHOLD) ||
        content.length > MAX_ANIMATED_MARKDOWN_CHARS
      fadeRun = beginRun(fadeState, suppress)
      renderedContent = renderChildren(parsedContent.bodyNodes, fadeRun)
      footnotes = renderFootnotes(parsedContent.footnotes, fadeRun)
      stageRun(fadeRun)
    } else {
      renderedContent = renderChildren(parsedContent.bodyNodes)
      footnotes = renderFootnotes(parsedContent.footnotes)
    }
  } else {
    renderedContent = content
    footnotes = renderFootnotes(parsedContent.footnotes)
  }

  useLayoutEffect(() => {
    if (!shouldAnimate) {
      return
    }
    const fadeState = fadeStateRef.current
    if (fadeState == null) {
      return
    }
    commitRun(fadeState)
  })

  return (
    <div
      className={cn(
        'size-full min-w-0 text-pretty [&>*:first-child]:mt-0 [&>*:last-child]:mb-0',
        props.className
      )}
    >
      {renderedContent}
      {footnotes}
    </div>
  )
})

Response.displayName = 'Response'
