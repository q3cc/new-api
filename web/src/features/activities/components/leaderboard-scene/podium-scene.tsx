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
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { cn } from '@/lib/utils'

import type { LeaderboardRow } from '../../types'
import { Trophy } from './scene-art'
import { Fireworks } from './scene-effects'

const STARS = 36
const COUNT_UP_MS = 1200
/** Columns by rank: second place stands left of the winner, third right. */
const PODIUM_COLUMNS = [1, 0, 2]

type CountUpProps = {
  value: number
  delayMs: number
  format: (value: number) => string
}

/** A score that counts up to its value, and on to each new value. */
function CountUp(props: CountUpProps) {
  const [shown, setShown] = useState(0)
  const latest = useRef(0)
  useEffect(() => {
    const from = latest.current
    const to = props.value
    let frame = 0
    const step = (now: number, start: number) => {
      const progress = Math.min(Math.max((now - start) / COUNT_UP_MS, 0), 1)
      latest.current = from + (to - from) * (1 - (1 - progress) ** 3)
      setShown(latest.current)
      if (progress < 1) {
        frame = window.requestAnimationFrame((t) => step(t, start))
      }
    }
    const reduced = window.matchMedia(
      '(prefers-reduced-motion: reduce)'
    ).matches
    const begin = performance.now() + (reduced ? -COUNT_UP_MS : props.delayMs)
    frame = window.requestAnimationFrame((now) => step(now, begin))
    return () => window.cancelAnimationFrame(frame)
  }, [props.value, props.delayMs])
  return <>{props.format(shown)}</>
}

type PodiumSceneProps = {
  /** The top three, best rank first. */
  rows: LeaderboardRow[]
  meRank: number
  final: boolean
  running: boolean
  formatScore: (score: number) => string
}

/** The top three on a podium under sweeping spotlights. */
export function PodiumScene(props: PodiumSceneProps) {
  const { t } = useTranslation()
  const [shown, setShown] = useState(false)
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => setShown(true))
    return () => window.cancelAnimationFrame(frame)
  }, [])

  return (
    <figure
      aria-label={t('Top 3 podium')}
      className={cn(
        'lb-stage lb-podium m-0',
        props.running && 'lb-running',
        props.final && 'lb-final'
      )}
    >
      <div aria-hidden='true'>
        {Array.from({ length: STARS }, (_, i) => (
          <span
            key={i}
            className='lb-star'
            style={{
              left: `${(i * 53) % 100}%`,
              top: `${(i * 29) % 70}%`,
              animationDelay: `${-(i % 9) * 0.3}s`,
            }}
          />
        ))}
        <div className='lb-spot lb-spot-left' />
        <div className='lb-spot lb-spot-right' />
      </div>
      <ol
        className={cn('lb-podium-row m-0 list-none p-0', shown && 'lb-shown')}
      >
        {PODIUM_COLUMNS.map((column, index) => {
          const rank = index + 1
          const row = props.rows.find((item) => item.rank === rank)
          const isMe = row !== undefined && row.rank === props.meRank
          const name = row ? row.display_name || `#${row.user_id}` : ''
          return (
            <li
              key={rank}
              className={`lb-step lb-p${rank}`}
              style={{ order: column }}
              aria-hidden={row ? undefined : true}
            >
              {rank === 1 && row ? (
                <>
                  <div className='lb-rays' aria-hidden='true' />
                  <Trophy />
                </>
              ) : null}
              {row ? (
                <>
                  <div className={`lb-avatar lb-m${rank}`} aria-hidden='true'>
                    {[...name][0]}
                    <span className='lb-ribbon' />
                  </div>
                  <div className='lb-pname'>
                    <span>{name}</span>
                    {isMe ? <span className='lb-you'>{t('You')}</span> : null}
                  </div>
                  <div className='lb-pscore'>
                    <CountUp
                      value={row.score}
                      delayMs={1200 + column * 250}
                      format={props.formatScore}
                    />
                  </div>
                </>
              ) : null}
              <div className='lb-block'>
                <b>{rank}</b>
              </div>
            </li>
          )
        })}
      </ol>
      <Fireworks play={props.final && shown} delayMs={2000} durationMs={5000} />
    </figure>
  )
}
