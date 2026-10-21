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
import { Edit, Minimize2Icon, RefreshCw, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'

import { MessageActionButton } from './message-action-button'

type MessageErrorActionsProps = {
  disabled?: boolean
  /** The provider refused the request as too long for the model's context. */
  contextLengthError?: boolean
  onDelete?: () => void
  onEditPrompt?: () => void
  onRetry?: () => void
  onCompress?: () => void
}

export function MessageErrorActions({
  disabled = false,
  contextLengthError = false,
  onDelete,
  onEditPrompt,
  onRetry,
  onCompress,
}: MessageErrorActionsProps) {
  const { t } = useTranslation()

  if (!onRetry && !onEditPrompt && !onDelete && !onCompress) {
    return null
  }

  return (
    <div className='flex flex-wrap items-center gap-0.5 pt-2'>
      {contextLengthError && !onCompress && (
        <p className='text-muted-foreground w-full pb-1 text-xs'>
          {t(
            'The conversation is too short to compress. Shorten the message or start a new conversation.'
          )}
        </p>
      )}
      {onCompress && (
        <Button
          className='touch-manipulation pointer-coarse:min-h-11'
          disabled={disabled}
          onClick={onCompress}
          size='sm'
          variant='outline'
        >
          <Minimize2Icon aria-hidden='true' />
          {t('Compress context and retry')}
        </Button>
      )}

      {onRetry && (
        <MessageActionButton
          disabled={disabled}
          icon={RefreshCw}
          label={t('Retry')}
          onClick={onRetry}
        />
      )}

      {onEditPrompt && (
        <MessageActionButton
          disabled={disabled}
          icon={Edit}
          label={t('Edit')}
          onClick={onEditPrompt}
        />
      )}

      {onDelete && (
        <MessageActionButton
          disabled={disabled}
          icon={Trash2}
          label={t('Delete')}
          onClick={onDelete}
          variant='destructive'
        />
      )}
    </div>
  )
}
