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
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ConfirmDialog } from '@/components/confirm-dialog'
import { Dialog } from '@/components/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { getServerErrorMessage } from '@/lib/server-error-message'

import { DELETE_CONFIRM_DELAY_SECONDS } from '../constants'

type Props = {
  action: 'rename' | 'delete'
  title: string
  onClose: () => void
  onConfirm: (title: string) => Promise<void>
}
export function ConversationDialogs(props: Props) {
  const { t } = useTranslation()
  const [title, setTitle] = useState(props.title)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<unknown>()
  async function confirm() {
    setPending(true)
    setError(undefined)
    try {
      await props.onConfirm(title.trim())
      props.onClose()
    } catch (failure: unknown) {
      setError(failure)
    } finally {
      setPending(false)
    }
  }
  const errorMessage = !!error && (
    <p role='alert' className='text-destructive text-sm'>
      {getServerErrorMessage(error, t('Failed to save conversation'))}
    </p>
  )
  if (props.action === 'delete') {
    return (
      <ConfirmDialog
        open
        destructive
        confirmDelay={DELETE_CONFIRM_DELAY_SECONDS}
        title={t('Delete conversation?')}
        desc={t(
          'This conversation and all its messages will be removed. This cannot be undone.'
        )}
        confirmText={t('Delete')}
        onOpenChange={(open) => {
          if (!open) props.onClose()
        }}
        isLoading={pending}
        handleConfirm={() => void confirm()}
      >
        {errorMessage}
      </ConfirmDialog>
    )
  }
  return (
    <Dialog
      open
      title={t('Rename conversation')}
      onOpenChange={(open) => {
        if (!open) props.onClose()
      }}
      footer={
        <Button
          disabled={pending || !title.trim()}
          onClick={() => void confirm()}
        >
          {t('Save')}
        </Button>
      }
    >
      <Input
        aria-label={t('Conversation title')}
        value={title}
        maxLength={200}
        onChange={(event) => setTitle(event.target.value)}
      />
      {errorMessage}
    </Dialog>
  )
}
