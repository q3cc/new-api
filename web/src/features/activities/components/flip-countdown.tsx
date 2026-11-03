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
import '@/styles/activity-scenes.css'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { cn } from '@/lib/utils'

type FlipCountdownProps = {
  /** When the countdown reaches zero, in Unix seconds. */
  target: number
  label: string
  className?: string
}

function FlipDigits(props: { value: string }) {
  return (
    <>
      {Array.from(props.value, (char, i) => (
        <span key={i} className='flip-digit'>
          <span key={char}>{char}</span>
        </span>
      ))}
    </>
  )
}

/** Days, hours, minutes and seconds left, on flip-clock tiles. */
export function FlipCountdown(props: FlipCountdownProps) {
  const { t } = useTranslation()
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000))
  useEffect(() => {
    const timer = window.setInterval(
      () => setNow(Math.floor(Date.now() / 1000)),
      1000
    )
    return () => window.clearInterval(timer)
  }, [])

  const left = Math.max(props.target - now, 0)
  const pad = (value: number) => String(value).padStart(2, '0')
  const days = pad(Math.floor(left / 86_400))
  const hours = pad(Math.floor((left % 86_400) / 3600))
  const minutes = pad(Math.floor((left % 3600) / 60))
  const seconds = pad(left % 60)

  return (
    <div
      role='timer'
      aria-label={`${props.label} ${days} ${t('days')} ${hours}:${minutes}:${seconds}`}
      className={cn('flex flex-col gap-1', props.className)}
    >
      <span className='text-muted-foreground text-xs' aria-hidden='true'>
        {props.label}
      </span>
      <span
        className='flex items-center gap-1 font-semibold'
        aria-hidden='true'
      >
        <FlipDigits value={days} />
        <span className='mx-0.5 text-xs'>{t('days')}</span>
        <FlipDigits value={hours} />
        <span>:</span>
        <FlipDigits value={minutes} />
        <span>:</span>
        <FlipDigits value={seconds} />
      </span>
    </div>
  )
}
