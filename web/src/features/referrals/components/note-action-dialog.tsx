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
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useId, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { ConfirmDialog } from '@/components/confirm-dialog'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { getServerErrorMessage } from '@/lib/server-error-message'

import { REFERRALS_QUERY_KEY } from '../api'

const NOTE_MAX_LENGTH = 255

/** An admin action on a referral record that takes an optional note. */
export type ReferralNoteAction = {
  /** Identifies the target, so a new target starts with an empty note. */
  key: string
  title: string
  desc: string
  subject?: ReactNode
  confirmText: string
  destructive?: boolean
  successMessage: string
  run: (note: string) => Promise<unknown>
}

type NoteActionDialogProps = {
  action: ReferralNoteAction | null
  onClose: () => void
}

/** Confirms an admin action with an optional note and refreshes every referral view once it succeeds. */
export function NoteActionDialog(props: NoteActionDialogProps) {
  return (
    <NoteActionDialogContent
      key={props.action?.key ?? 'closed'}
      action={props.action}
      onClose={props.onClose}
    />
  )
}

function NoteActionDialogContent(props: NoteActionDialogProps) {
  const { t } = useTranslation()
  const noteId = useId()
  const queryClient = useQueryClient()
  const [note, setNote] = useState('')
  const mutation = useMutation({
    mutationFn: (action: ReferralNoteAction) => action.run(note.trim()),
    meta: { errorToast: false },
    onSuccess: async (_, action) => {
      props.onClose()
      toast.success(action.successMessage)
      await queryClient.invalidateQueries({ queryKey: [REFERRALS_QUERY_KEY] })
    },
  })
  const action = props.action
  return (
    <ConfirmDialog
      open={!!action}
      onOpenChange={(open) => {
        if (!open && !mutation.isPending) props.onClose()
      }}
      title={action?.title ?? ''}
      desc={action?.desc ?? ''}
      confirmText={action?.confirmText}
      destructive={action?.destructive}
      isLoading={mutation.isPending}
      handleConfirm={() => {
        if (action && !mutation.isPending) mutation.mutate(action)
      }}
    >
      {action?.subject}
      <div className='grid gap-2'>
        <Label htmlFor={noteId}>{t('Note (optional)')}</Label>
        <Textarea
          id={noteId}
          value={note}
          maxLength={NOTE_MAX_LENGTH}
          onChange={(event) => setNote(event.target.value)}
        />
      </div>
      {mutation.isError && (
        <p role='alert' className='text-destructive text-sm'>
          {getServerErrorMessage(mutation.error)}
        </p>
      )}
    </ConfirmDialog>
  )
}
