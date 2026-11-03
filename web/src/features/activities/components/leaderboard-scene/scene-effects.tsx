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
import { useEffect, useRef, type CSSProperties } from 'react'

const FIREWORK_COLORS = [
  '#ffd166',
  '#ff5d8f',
  '#4dabff',
  '#3ef08a',
  '#c77dff',
  '#ff9f1c',
  '#ffffff',
]

type Spark = {
  x: number
  y: number
  vx: number
  vy: number
  life: number
  color: string
}

type FireworksProps = {
  /** Starts the show; it plays once each time this turns true. */
  play: boolean
  delayMs: number
  durationMs: number
}

/** Bursts of fireworks drawn over a scene to celebrate the final ranks. */
export function Fireworks(props: FireworksProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!props.play || !canvas) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    let frame = 0
    const start = window.setTimeout(() => {
      const context = canvas.getContext('2d')
      if (!context) return
      const ratio = window.devicePixelRatio || 1
      const width = canvas.clientWidth
      const height = canvas.clientHeight
      canvas.width = width * ratio
      canvas.height = height * ratio
      context.setTransform(ratio, 0, 0, ratio, 0, 0)
      const end = performance.now() + props.durationMs
      let sparks: Spark[] = []
      let nextBurst = 0
      const draw = (now: number) => {
        context.clearRect(0, 0, width, height)
        if (now < end && now > nextBurst) {
          const x = width * (0.15 + Math.random() * 0.7)
          const y = height * (0.12 + Math.random() * 0.35)
          const color =
            FIREWORK_COLORS[Math.floor(Math.random() * FIREWORK_COLORS.length)]
          for (let i = 0; i < 46; i++) {
            const angle = (Math.PI * 2 * i) / 46
            const speed = 1.4 + Math.random() * 2.4
            sparks.push({
              x,
              y,
              vx: Math.cos(angle) * speed,
              vy: Math.sin(angle) * speed,
              life: 1,
              color,
            })
          }
          nextBurst = now + 380 + Math.random() * 300
        }
        sparks = sparks.filter((spark) => spark.life > 0)
        for (const spark of sparks) {
          spark.x += spark.vx
          spark.y += spark.vy
          spark.vy += 0.035
          spark.vx *= 0.985
          spark.life -= 0.012
          context.globalAlpha = Math.max(spark.life, 0)
          context.fillStyle = spark.color
          context.beginPath()
          context.arc(spark.x, spark.y, 2.1, 0, Math.PI * 2)
          context.fill()
        }
        if (now < end || sparks.length > 0) {
          frame = window.requestAnimationFrame(draw)
        }
      }
      frame = window.requestAnimationFrame(draw)
    }, props.delayMs)
    return () => {
      window.clearTimeout(start)
      window.cancelAnimationFrame(frame)
    }
  }, [props.play, props.delayMs, props.durationMs])

  return <canvas ref={canvasRef} className='lb-fireworks' aria-hidden='true' />
}

const CONFETTI_COLORS = [
  '#ffd166',
  '#ff5d8f',
  '#4dabff',
  '#3ef08a',
  '#c77dff',
  '#ff9f1c',
]
const CONFETTI_PIECES = 90

type ConfettiBurstProps = {
  /** Each new value throws another burst; 0 throws none. */
  burst: number
  delaySeconds?: number
}

/**
 * Confetti falling over the nearest positioned ancestor. The pieces are
 * spread by their index, so every burst looks the same and renders purely.
 */
export function ConfettiBurst(props: ConfettiBurstProps) {
  if (props.burst === 0) return null
  const delay = props.delaySeconds ?? 0
  return (
    <div key={props.burst} className='confetti-layer' aria-hidden='true'>
      {Array.from({ length: CONFETTI_PIECES }, (_, i) => (
        <i
          key={i}
          className='confetti-piece'
          style={
            {
              left: `${(i * 37) % 100}%`,
              background: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
              '--dx': `${(((i * 53) % 100) - 50) * 4}px`,
              '--dy': `${320 + ((i * 29) % 100) * 3}px`,
              '--rot': `${(((i * 71) % 100) - 50) * 20}deg`,
              '--d': `${1.8 + (i % 7) * 0.2}s`,
              '--delay': `${delay + (i % 5) * 0.1}s`,
            } as CSSProperties
          }
        />
      ))}
    </div>
  )
}
