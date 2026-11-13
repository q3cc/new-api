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
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Dialog } from '@/components/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { handleServerError } from '@/lib/handle-server-error'
import { requireServerSuccess } from '@/lib/server-error-message'

import { activitiesQueryKeys, submitWinnerInfo } from '../api'
import type { LotteryWin } from '../types'

type WinnerInfoDialogProps = {
  /** The win being filled in; null keeps the dialog closed. */
  win: LotteryWin | null
  onClose: () => void
}

/** Where a winner fills in what the activity asks for to receive a prize. */
export function WinnerInfoDialog(props: WinnerInfoDialogProps) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const win = props.win
  const [values, setValues] = useState<string[]>([])

  useEffect(() => {
    if (!win) return
    // Answers are matched by name: the activity's fields may have been edited.
    setValues(
      win.winner_fields.map(
        (field) =>
          win.winner_info.find((answer) => answer.label === field.label)
            ?.value ?? ''
      )
    )
  }, [win])

  const save = useMutation({
    mutationFn: async (id: number) =>
      requireServerSuccess(await submitWinnerInfo(id, values)),
    onSuccess: () => {
      toast.success(t('Information saved'))
      void queryClient.invalidateQueries({ queryKey: activitiesQueryKeys.all })
      props.onClose()
    },
    onError: (error) => handleServerError(error),
  })

  const fields = win?.winner_fields ?? []
  const missing = fields.some(
    (field, index) => field.required && !(values[index] ?? '').trim()
  )

  return (
    <Dialog
      open={win !== null}
      onOpenChange={(open) => {
        if (!open) props.onClose()
      }}
      title={t('Information for your prize')}
      description={
        win
          ? t('{{prize}} from {{activity}}', {
              prize: win.prize_name,
              activity: win.activity_title,
            })
          : undefined
      }
      contentClassName='sm:max-w-lg'
      footer={
        <>
          <Button variant='outline' onClick={props.onClose}>
            {t('Cancel')}
          </Button>
          <Button
            form='winner-info-form'
            type='submit'
            disabled={missing || save.isPending}
          >
            {save.isPending ? t('Saving...') : t('Save')}
          </Button>
        </>
      }
    >
      <form
        id='winner-info-form'
        className='space-y-4'
        onSubmit={(event) => {
          event.preventDefault()
          if (win && !missing) save.mutate(win.id)
        }}
      >
        {win?.winner_notice ? (
          <p className='text-muted-foreground text-sm whitespace-pre-wrap'>
            {win.winner_notice}
          </p>
        ) : null}
        {fields.map((field, index) => (
          <div key={field.label} className='space-y-2'>
            <Label htmlFor={`winner-info-${index}`}>
              {field.label}
              {field.required ? (
                <span className='text-destructive' aria-hidden='true'>
                  *
                </span>
              ) : null}
            </Label>
            <Input
              id={`winner-info-${index}`}
              value={values[index] ?? ''}
              maxLength={255}
              required={field.required}
              onChange={(event) =>
                setValues((current) =>
                  fields.map((_, i) =>
                    i === index ? event.target.value : (current[i] ?? '')
                  )
                )
              }
            />
          </div>
        ))}
      </form>
    </Dialog>
  )
}
