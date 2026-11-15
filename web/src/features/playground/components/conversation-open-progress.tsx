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
import { useTranslation } from 'react-i18next'

import { Progress } from '@/components/ui/progress'
import { toIntlLocale } from '@/i18n/languages'
import { formatNumber } from '@/lib/format'

import type { OpenProgress } from '../lib/conversation-workspace'

/**
 * Shows how far a conversation being opened has loaded. Without a known size
 * the bar is indeterminate; with one it stops short of full until the
 * conversation is shown, since the response is a little larger than the
 * document alone.
 */
export function ConversationOpenProgress(props: { progress: OpenProgress }) {
  const { t, i18n } = useTranslation()
  const { loaded, total, archived } = props.progress
  const percent = total
    ? Math.min(99, Math.floor((loaded / total) * 100))
    : null
  return (
    <div
      className='flex flex-1 flex-col items-center justify-center gap-3 p-6'
      role='status'
    >
      <div className='w-full max-w-sm space-y-2'>
        <div className='flex items-center justify-between gap-2 text-sm'>
          <span>
            {archived
              ? t('Restoring a conversation not opened for a while...')
              : t('Loading conversation...')}
          </span>
          {percent !== null && (
            <span className='text-muted-foreground tabular-nums'>
              {formatNumber(
                percent,
                toIntlLocale(i18n.resolvedLanguage || i18n.language)
              )}
              %
            </span>
          )}
        </div>
        <Progress
          value={percent}
          aria-label={t('Conversation loading progress')}
        />
      </div>
    </div>
  )
}
