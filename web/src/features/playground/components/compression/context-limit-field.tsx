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

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { formatNumber } from '@/lib/format'

type Props = {
  id: string
  name: string
  /** The largest value accepted; the model's own limit when it is known. */
  ceiling: number
  known: boolean
  value?: number
  locale?: string
  disabled: boolean
  invalid: boolean
  onChange: (value: number | null) => void
  onReset: () => void
}

/** The context budget of one model, entered by hand or learned. */
export function ContextLimitField(props: Props) {
  const { t } = useTranslation()
  return (
    <div className='space-y-2'>
      <Label htmlFor={props.id}>
        {t('Context budget')} · {props.name}
      </Label>
      <div className='flex gap-2'>
        <Input
          id={props.id}
          key={`${props.name}-${props.value}`}
          type='number'
          min={1}
          max={props.ceiling}
          defaultValue={props.value ?? (props.known ? props.ceiling : '')}
          disabled={props.disabled}
          aria-invalid={props.invalid}
          onBlur={(event) => {
            const value = Number(event.target.value)
            const valid =
              Number.isSafeInteger(value) && value > 0 && value <= props.ceiling
            props.onChange(valid ? value : null)
          }}
        />
        <Button
          variant='outline'
          disabled={props.disabled}
          onClick={props.onReset}
        >
          {t('Reset')}
        </Button>
      </div>
      <span className='text-muted-foreground'>
        {props.known
          ? `${t('Maximum')}: ${formatNumber(props.ceiling, props.locale)}`
          : t(
              'Context limit unknown; learned from the provider when a request is too long'
            )}
      </span>
    </div>
  )
}
