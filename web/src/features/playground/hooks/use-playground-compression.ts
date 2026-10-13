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
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo } from 'react'

import { useDebounce } from '@/hooks/use-debounce'

import {
  getCompressionPreference,
  getModelCapabilities,
  estimateContext,
} from '../compression-api'
import {
  chatMessages,
  shouldCompress,
  contextMessages,
  inputBudget,
  compressionSourceHash,
} from '../lib/context-compression'
import type {
  ConversationEntry,
  ConversationWorkspace,
} from '../lib/conversation-workspace'
import type { Message } from '../types'

export function usePlaygroundCompression(
  entry: ConversationEntry,
  workspace: ConversationWorkspace,
  active = true
) {
  const client = useQueryClient()
  const group = entry.row.document.config.group
  const preferenceOptions = {
    queryKey: ['playground-preference', workspace.owner],
    queryFn: ({ signal }: { signal: AbortSignal }) =>
      getCompressionPreference(signal),
    staleTime: 30000,
    meta: { errorToast: false },
  }
  const capabilityOptions = {
    queryKey: ['playground-capabilities', workspace.owner, group],
    queryFn: ({ signal }: { signal: AbortSignal }) =>
      getModelCapabilities(group, signal),
    staleTime: 30000,
    meta: { errorToast: false },
  }
  const preference = useQuery(preferenceOptions)
  const capabilities = useQuery(capabilityOptions)
  const document = entry.row.document
  const busy =
    !!entry.compressionProgress ||
    document.messages.some(
      (message) =>
        message.status === 'loading' || message.status === 'streaming'
    )
  const usageMessages = useMemo(() => {
    if (busy) return []
    const messages = contextMessages(document)
    return document.draft.trim()
      ? [
          ...messages,
          {
            key: 'context-draft',
            from: 'user' as const,
            versions: [{ id: 'draft', content: document.draft.trim() }],
          },
        ]
      : messages
  }, [document, busy])
  const usageHash = compressionSourceHash(usageMessages)
  const debouncedHash = useDebounce(usageHash, 600)
  const capability = capabilities.data?.find(
    (item) => item.model === document.config.model
  )
  const budget = capability?.text_generation
    ? inputBudget(
        capability,
        document.contextLimits?.[capability.model],
        document.parameterEnabled.max_tokens ? document.config.max_tokens : 4096
      )
    : undefined
  const usage = useQuery({
    queryKey: [
      'playground-context-usage',
      workspace.owner,
      entry.key,
      group,
      document.config.model,
      usageHash,
    ],
    queryFn: ({ signal }) =>
      estimateContext(
        document.config.model,
        group,
        chatMessages(usageMessages),
        signal
      ),
    enabled:
      active &&
      workspace.isActive() &&
      !busy &&
      usageHash === debouncedHash &&
      budget !== undefined,
    staleTime: 30000,
    gcTime: 0,
    retry: false,
    meta: { errorToast: false },
  })

  async function prepare(
    messages: Message[],
    signal: AbortSignal
  ): Promise<Message[]> {
    const [defaults, models] = await Promise.all([
      client.fetchQuery(preferenceOptions),
      client.fetchQuery(capabilityOptions),
    ])
    signal.throwIfAborted()
    if (!workspace.isActive()) throw new Error('Compression stopped')
    const current = workspace.getSnapshot().entries[entry.key]
    let document = { ...current.row.document, messages }
    const settings = document.compressionSettings ?? defaults
    const capability = models.find(
      (model) => model.model === document.config.model
    )
    if (!capability?.text_generation) return contextMessages(document)
    const output = document.parameterEnabled.max_tokens
      ? document.config.max_tokens
      : 4096
    const budget = inputBudget(
      capability,
      document.contextLimits?.[capability.model],
      output
    )
    if (budget <= 0) throw new Error('Context budget is too small')
    let result = contextMessages(document)
    let count = await estimateContext(
      capability.model,
      group,
      chatMessages(result),
      signal
    )
    if (
      settings.automatic &&
      shouldCompress(document, count.input_tokens, budget)
    ) {
      if (document.compressionAttempt) {
        throw new Error('Retry compression before sending')
      }
      const model = models.find(
        (model) => model.model === settings.model && model.text_generation
      )
      if (!model) throw new Error('Compression model is not available')
      signal.throwIfAborted()
      if (!(await workspace.compress(entry.key, model, signal))) {
        throw (
          workspace.getSnapshot().entries[entry.key]?.compressionError ??
          new Error('Compression did not complete')
        )
      }
      signal.throwIfAborted()
      document = workspace.getSnapshot().entries[entry.key].row.document
      result = contextMessages(document)
      count = await estimateContext(
        capability.model,
        group,
        chatMessages(result),
        signal
      )
    }
    signal.throwIfAborted()
    if (count.input_tokens > budget) {
      throw new Error('Compressed context is still too large')
    }
    return result
  }
  return { preference, capabilities, prepare, usage, budget, busy }
}
