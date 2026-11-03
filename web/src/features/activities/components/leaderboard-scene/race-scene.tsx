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
import { useEffect, useState, type CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'

import { cn } from '@/lib/utils'

import {
  keepLanes,
  racePositions,
  rankClimbers,
} from '../../lib/leaderboard-scene'
import type { LeaderboardRow } from '../../types'
import { LANE_LOOKS } from './lane-looks'
import { CarArt, HorseArt, WinnerCrown } from './scene-art'
import { ConfettiBurst, Fireworks } from './scene-effects'

const LIGHT_STEP_MS = 350
const LIGHTS = 5
const FAN_COLORS = [
  '#ff5d5d',
  '#ffd166',
  '#06d6a0',
  '#4dabff',
  '#c77dff',
  '#ff9f1c',
  '#f1f1f1',
  '#ef476f',
]
const FANS = 140
const FAN_ROWS = 4
const FLAGS = [
  { left: 10, color: '#ffd400' },
  { left: 30, color: '#ff4d6d' },
  { left: 50, color: '#4dabff' },
  { left: 70, color: '#06d6a0' },
  { left: 90, color: '#ffd400' },
]

function Grandstand(props: { flags: boolean }) {
  const columns = Math.ceil(FANS / FAN_ROWS)
  return (
    <div className='lb-stand'>
      {props.flags
        ? FLAGS.map((flag) => (
            <span
              key={flag.left}
              className='lb-flag'
              style={
                {
                  left: `${flag.left}%`,
                  '--c': flag.color,
                  animationDelay: `${-flag.left / 100}s`,
                } as CSSProperties
              }
            />
          ))
        : null}
      <div className='lb-stand-roof' />
      <div className='lb-stand-body'>
        <div className='lb-crowd'>
          {Array.from({ length: FANS }, (_, i) => {
            const row = i % FAN_ROWS
            const column = Math.floor(i / FAN_ROWS)
            return (
              <span
                key={i}
                className='lb-fan'
                style={{
                  left: `${(column / columns) * 100 + (row % 2) * (50 / columns)}%`,
                  top: 8 + row * 12,
                  background: FAN_COLORS[(i * 7) % FAN_COLORS.length],
                  animationDelay: `${-((i * 37) % 100) / 100}s`,
                }}
              />
            )
          })}
        </div>
      </div>
    </div>
  )
}

type RaceSceneProps = {
  kind: 'horse' | 'car'
  /** The top three, best rank first. */
  rows: LeaderboardRow[]
  meRank: number
  /** Ranks are locked: the winner crosses the line and is crowned. */
  final: boolean
  /** The leaderboard is open, so the runners keep running. */
  running: boolean
  formatScore: (score: number) => string
}

/**
 * The top three as a horse or car race. Each runner's distance shows its
 * score against the leader's; runners keep their lanes, so a climb in rank
 * shows as one passing another.
 */
export function RaceScene(props: RaceSceneProps) {
  const { t } = useTranslation()
  const signature = props.rows.map((row) => `${row.user_id}:${row.rank}`).join()
  const [seen, setSeen] = useState({ signature, rows: props.rows })
  const [lanes, setLanes] = useState(() => props.rows.map((row) => row.user_id))
  const [climb, setClimb] = useState({ ids: [] as number[], key: 0 })
  if (seen.signature !== signature) {
    const climbers = rankClimbers(seen.rows, props.rows)
    setSeen({ signature, rows: props.rows })
    setLanes(keepLanes(lanes, props.rows))
    if (climbers.length > 0) setClimb({ ids: climbers, key: climb.key + 1 })
  }

  // Horses leave right away; cars wait for the start lights to go out.
  const [started, setStarted] = useState(false)
  const [lights, setLights] = useState(0)
  const isCar = props.kind === 'car'
  useEffect(() => {
    const reduced = window.matchMedia(
      '(prefers-reduced-motion: reduce)'
    ).matches
    if (!isCar || reduced) {
      const frame = window.requestAnimationFrame(() => setStarted(true))
      return () => window.cancelAnimationFrame(frame)
    }
    const timers = Array.from({ length: LIGHTS }, (_, i) =>
      window.setTimeout(() => setLights(i + 1), LIGHT_STEP_MS * (i + 1))
    )
    timers.push(
      window.setTimeout(
        () => setStarted(true),
        LIGHT_STEP_MS * (LIGHTS + 1) + 300
      )
    )
    return () => timers.forEach((timer) => window.clearTimeout(timer))
  }, [isCar])

  const positions = racePositions(props.rows, props.final)
  const byId = new Map(props.rows.map((row) => [row.user_id, row]))
  const Art = isCar ? CarArt : HorseArt
  const edge = <div className={isCar ? 'lb-kerb' : 'lb-rail'} />

  return (
    <figure
      aria-label={isCar ? t('Top 3 car race') : t('Top 3 horse race')}
      className={cn(
        'lb-stage m-0',
        isCar ? 'lb-car' : 'lb-horse',
        props.running && started && 'lb-running',
        props.final && 'lb-final'
      )}
    >
      <div className='lb-scenery' aria-hidden='true'>
        {isCar ? (
          <>
            <div className='lb-skyline' />
            <span className='lb-floodlight' style={{ left: '8%' }} />
            <span className='lb-floodlight' style={{ right: '8%' }} />
            <Grandstand flags={false} />
            <div className={cn('lb-lights', started && 'lb-lights-off')}>
              {Array.from({ length: LIGHTS }, (_, i) => (
                <i key={i} className={cn(i < lights && 'lb-light-on')} />
              ))}
            </div>
            {started && lights === LIGHTS ? (
              <div className='lb-go'>{t('GO!')}</div>
            ) : null}
          </>
        ) : (
          <>
            <div className='lb-sun' />
            <div
              className='lb-cloud'
              style={{ top: 20, width: 60, animationDuration: '38s' }}
            />
            <div
              className='lb-cloud'
              style={{
                top: 48,
                width: 44,
                animationDuration: '52s',
                animationDelay: '-20s',
              }}
            />
            <Grandstand flags />
            <div className='lb-hedge' />
          </>
        )}
      </div>
      {edge}
      <div className='lb-lanes'>
        <div className='lb-finish-line' aria-hidden='true' />
        {isCar ? (
          <div className='lb-chequered' aria-hidden='true' />
        ) : (
          <>
            <div className='lb-finish-post' aria-hidden='true' />
            <div className='lb-finish-sign' aria-hidden='true'>
              {t('Finish')}
            </div>
          </>
        )}
        <ol className='m-0 list-none p-0'>
          {lanes.map((userId, lane) => {
            const row = byId.get(userId)
            if (!row) return null
            const position = positions.get(userId) ?? 0
            let left = isCar ? 'var(--lb-grid-left)' : '0%'
            if (started) left = `${position}%`
            const isMe = row.rank === props.meRank
            return (
              <li key={userId} className={`lb-lane lb-lane-${lane + 1}`}>
                <span className='lb-lane-no' aria-hidden='true'>
                  {lane + 1}
                </span>
                <div
                  className={cn('lb-runner', row.rank === 1 && 'lb-is-first')}
                  style={{ left, transitionDelay: `${lane * 0.15}s` }}
                >
                  <span
                    className={cn(
                      'lb-tag',
                      started && position < 50 && 'lb-tag-left',
                      isMe && 'lb-tag-me'
                    )}
                  >
                    <span className={`lb-medal lb-m${row.rank}`}>
                      {row.rank}
                    </span>
                    <span className='lb-tag-name'>
                      {row.display_name || `#${row.user_id}`}
                    </span>
                    {isMe ? <span className='lb-you'>{t('You')}</span> : null}
                    <span className='lb-tag-score'>
                      {props.formatScore(row.score)}
                    </span>
                  </span>
                  {climb.ids.includes(userId) ? (
                    <span
                      key={climb.key}
                      className='lb-burst'
                      aria-hidden='true'
                    >
                      {t('Overtake!')}
                    </span>
                  ) : null}
                  {isCar ? (
                    <span className='lb-speedlines' aria-hidden='true'>
                      <i />
                      <i />
                      <i />
                    </span>
                  ) : (
                    <span className='lb-dust' aria-hidden='true'>
                      <i />
                      <i />
                      <i />
                    </span>
                  )}
                  <WinnerCrown />
                  <Art look={LANE_LOOKS[lane]} number={lane + 1} />
                </div>
              </li>
            )
          })}
        </ol>
      </div>
      {edge}
      <Fireworks
        play={props.final && started}
        delayMs={2400}
        durationMs={4500}
      />
      <ConfettiBurst
        burst={props.final && started ? 1 : 0}
        delaySeconds={2.4}
      />
    </figure>
  )
}
