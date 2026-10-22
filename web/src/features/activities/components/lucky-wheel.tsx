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
import { Loader2 } from 'lucide-react'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

import type { LotteryEntry, LotteryPrize } from '../types'

const SPIN_DURATION_MS = 4200
const SPIN_TURNS = 6
const RADIUS = 100

type LuckyWheelProps = {
  prizes: LotteryPrize[]
  disabled: boolean
  /** Asks the server to spin; resolves to null when the spin failed. */
  onSpin: () => Promise<LotteryEntry | null>
  /** Called once the wheel has stopped on the result. */
  onSettled: (entry: LotteryEntry) => void
}

function segmentPath(index: number, count: number): string {
  const angle = (2 * Math.PI) / count
  const start = index * angle - Math.PI / 2
  const end = start + angle
  const x1 = RADIUS + RADIUS * Math.cos(start)
  const y1 = RADIUS + RADIUS * Math.sin(start)
  const x2 = RADIUS + RADIUS * Math.cos(end)
  const y2 = RADIUS + RADIUS * Math.sin(end)
  const largeArc = angle > Math.PI ? 1 : 0
  return `M${RADIUS},${RADIUS} L${x1},${y1} A${RADIUS},${RADIUS} 0 ${largeArc} 1 ${x2},${y2} Z`
}

function shortLabel(label: string): string {
  return label.length > 8 ? `${label.slice(0, 7)}…` : label
}

/**
 * A prize wheel whose result is decided by the server: the wheel only turns
 * to the segment of the prize the spin returned.
 */
export function LuckyWheel(props: LuckyWheelProps) {
  const { t } = useTranslation()
  const [rotation, setRotation] = useState(0)
  const [spinning, setSpinning] = useState(false)
  const pending = useRef<LotteryEntry | null>(null)
  const segments = [
    ...props.prizes.map((prize) => ({ id: prize.id, label: prize.name })),
    { id: 0, label: t('Thanks for joining') },
  ]
  const segmentAngle = 360 / segments.length

  const settle = () => {
    const entry = pending.current
    pending.current = null
    setSpinning(false)
    if (entry) props.onSettled(entry)
  }

  const handleSpin = async () => {
    setSpinning(true)
    const entry = await props.onSpin()
    if (!entry) {
      setSpinning(false)
      return
    }
    pending.current = entry
    // A prize missing from the wheel (edited since load) lands on "no prize".
    const found = segments.findIndex((segment) => segment.id === entry.prize_id)
    const landing = found === -1 ? segments.length - 1 : found
    // Bring the middle of the landing segment under the pointer at the top.
    const target = 360 - (landing + 0.5) * segmentAngle
    const current = ((rotation % 360) + 360) % 360
    const delta = (((target - current) % 360) + 360) % 360
    setRotation(rotation + SPIN_TURNS * 360 + delta)
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      settle()
    }
  }

  return (
    <div className='flex flex-col items-center gap-4'>
      <div className='relative size-56 sm:size-64'>
        <div
          aria-hidden='true'
          className='border-t-primary absolute top-[-6px] left-1/2 z-10 size-0 -translate-x-1/2 border-x-[10px] border-t-[16px] border-x-transparent'
        />
        <svg
          viewBox={`0 0 ${RADIUS * 2} ${RADIUS * 2}`}
          role='img'
          aria-label={t('Prize wheel with {{count}} segments', {
            count: segments.length,
          })}
          className='size-full drop-shadow-sm motion-safe:transition-transform motion-safe:ease-[cubic-bezier(0.17,0.67,0.12,0.99)]'
          style={{
            transform: `rotate(${rotation}deg)`,
            transitionDuration: `${SPIN_DURATION_MS}ms`,
          }}
          onTransitionEnd={settle}
        >
          {segments.map((segment, index) => {
            const isEmpty = segment.id === 0
            const labelAngle = (index + 0.5) * segmentAngle
            return (
              <g key={segment.id}>
                <path
                  d={segmentPath(index, segments.length)}
                  className={cn(
                    'stroke-background stroke-[1.5]',
                    isEmpty && 'fill-muted',
                    !isEmpty && index % 2 === 0 && 'fill-primary/20',
                    !isEmpty && index % 2 === 1 && 'fill-primary/35'
                  )}
                />
                <text
                  x={RADIUS}
                  y={RADIUS * 0.32}
                  transform={`rotate(${labelAngle} ${RADIUS} ${RADIUS})`}
                  textAnchor='middle'
                  className='fill-foreground text-[9px] font-medium'
                >
                  {shortLabel(segment.label)}
                </text>
              </g>
            )
          })}
          <circle
            cx={RADIUS}
            cy={RADIUS}
            r={RADIUS * 0.16}
            className='fill-background stroke-border'
          />
        </svg>
      </div>
      <Button
        onClick={() => void handleSpin()}
        disabled={props.disabled || spinning}
        className='min-w-32'
      >
        {spinning ? <Loader2 className='size-4 animate-spin' /> : null}
        {spinning ? t('Spinning...') : t('Spin')}
      </Button>
    </div>
  )
}
