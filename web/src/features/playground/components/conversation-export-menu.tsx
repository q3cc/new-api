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
import { DownloadIcon } from 'lucide-react'
import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

import type { SavedConversation } from '../conversations-api'
import {
  downloadConversation,
  type ConversationExportFormat,
} from '../lib/conversation-export'
import { hasMessageContent } from '../lib/message/message-utils'

type Props = {
  conversation: SavedConversation
  busy: boolean
}

export const ConversationExportMenu = memo(function ConversationExportMenu(
  props: Props
) {
  const { t } = useTranslation()
  const disabled =
    props.busy || !props.conversation.document.messages.some(hasMessageContent)
  const download = (format: ConversationExportFormat) => {
    if (disabled) return
    try {
      downloadConversation(props.conversation, format)
    } catch {
      toast.error(t('Failed to export conversation'))
    }
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={disabled}
        render={
          <Button
            variant='ghost'
            size='icon'
            className='touch-manipulation pointer-coarse:size-10'
            aria-label={t('Export conversation')}
            disabled={disabled}
          >
            <DownloadIcon aria-hidden='true' />
          </Button>
        }
      />
      <DropdownMenuContent align='end' className='min-w-48'>
        <DropdownMenuItem onClick={() => download('json')}>
          {t('JSON (Chatbox compatible)')}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => download('md')}>
          {t('Markdown')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
})
