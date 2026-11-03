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
import { useId } from 'react'

import type { RunnerLook } from './lane-looks'

type ArtProps = {
  look: RunnerLook
  /** Lane number on the saddle cloth or the car. */
  number: number
}

type LegProps = {
  className: string
  x: number
  y: number
  color: string
}

function HorseLeg(props: LegProps) {
  const knee = props.y + 15
  return (
    <g
      className={props.className}
      style={{ transformOrigin: `${props.x}px ${props.y}px` }}
    >
      <path
        d={`M${props.x} ${props.y} L${props.x} ${knee}`}
        stroke={props.color}
        strokeWidth='6.5'
        strokeLinecap='round'
      />
      <g
        className='lb-shin'
        style={{ transformOrigin: `${props.x}px ${knee}px` }}
      >
        <path
          d={`M${props.x} ${knee} L${props.x} ${knee + 14}`}
          stroke={props.color}
          strokeWidth='4'
          strokeLinecap='round'
        />
        <rect
          x={props.x - 3}
          y={knee + 13}
          width='6'
          height='3.5'
          rx='1.2'
          fill='#222'
        />
      </g>
    </g>
  )
}

/** A galloping horse and its rider, facing right. */
export function HorseArt(props: ArtProps) {
  const look = props.look
  return (
    <svg className='lb-steed' viewBox='0 0 124 88' aria-hidden='true'>
      <ellipse cx='62' cy='85' rx='34' ry='3' fill='rgb(0 0 0 / 22%)' />
      <g className='lb-bob'>
        <HorseLeg className='lb-leg-ff' x={80} y={48} color={look.coatFar} />
        <HorseLeg className='lb-leg-bf' x={38} y={47} color={look.coatFar} />
        <g className='lb-tail' style={{ transformOrigin: '26px 38px' }}>
          <path
            d='M27 36 C16 33 8 42 5 56 C12 50 18 46 28 43 Z'
            fill={look.mane}
          />
        </g>
        <ellipse cx='56' cy='42' rx='31' ry='13.5' fill={look.coat} />
        <path
          d='M72 34 C79 26 85 17 91 11 L101 13 C99 22 95 33 87 47 Z'
          fill={look.coat}
        />
        <path
          d='M89 9 C93 5 100 5 104 9 L116 21 C118 24 116 28 112 28 L104 27 C99 26 95 21 91 17 Z'
          fill={look.coat}
        />
        <path d='M92 8 L94 1 L97 7 Z' fill={look.coat} />
        <path
          d='M89 10 C83 17 78 25 72 34 L77 35 C82 27 87 19 93 13 Z'
          fill={look.mane}
        />
        <circle cx='103' cy='13.5' r='1.4' fill='#111' />
        <path
          d='M99 11 L110 26 L94 26'
          stroke='#3a2412'
          strokeWidth='1.1'
          fill='none'
        />
        <rect
          x='44'
          y='33'
          width='20'
          height='14'
          rx='2.5'
          fill='#fff'
          stroke='rgb(0 0 0 / 15%)'
        />
        <text
          x='54'
          y='44'
          textAnchor='middle'
          fontSize='10'
          fontWeight='800'
          fill='#222'
        >
          {props.number}
        </text>
        <HorseLeg className='lb-leg-fn' x={76} y={49} color={look.coat} />
        <HorseLeg className='lb-leg-bn' x={34} y={48} color={look.coat} />
        <g className='lb-rider'>
          <path
            d='M60 33 L54 41 L61 43'
            stroke='#f4f4f4'
            strokeWidth='4.5'
            fill='none'
            strokeLinecap='round'
            strokeLinejoin='round'
          />
          <path
            d='M61 43 L64 43'
            stroke='#2b2b2b'
            strokeWidth='4.5'
            strokeLinecap='round'
          />
          <path
            d='M57 34 C61 24 69 19 78 19 L80 25 C72 26 66 30 62 37 Z'
            fill={look.silk}
          />
          <path d='M65 25 L70 32' stroke={look.silk2} strokeWidth='3.2' />
          <path
            d='M76 22 L87 27 L95 22'
            stroke={look.silk}
            strokeWidth='3.6'
            fill='none'
            strokeLinecap='round'
            strokeLinejoin='round'
          />
          <circle cx='83' cy='15' r='5.8' fill={look.silk2} />
          <path d='M78 13 C80 9 86 9 88.5 13 Z' fill={look.silk} />
          <path
            d='M86 15.5 L90 16'
            stroke='#222'
            strokeWidth='1.8'
            strokeLinecap='round'
          />
        </g>
      </g>
    </svg>
  )
}

function CarWheel(props: { cx: number }) {
  return (
    <g transform={`translate(${props.cx} 44)`}>
      <circle r='11' fill='#141414' />
      <g className='lb-wheel-spin'>
        <circle r='6.5' fill='#9aa0a6' />
        <path
          d='M0 -6 L0 6 M-6 0 L6 0 M-4.2 -4.2 L4.2 4.2 M-4.2 4.2 L4.2 -4.2'
          stroke='#3a3d42'
          strokeWidth='1.6'
        />
      </g>
      <circle r='2' fill='#222' />
    </g>
  )
}

/** A race car and its driver, facing right. */
export function CarArt(props: ArtProps) {
  const look = props.look
  return (
    <svg className='lb-racecar' viewBox='0 0 150 58' aria-hidden='true'>
      <ellipse cx='76' cy='55' rx='62' ry='3' fill='rgb(0 0 0 / 35%)' />
      <g className='lb-chassis'>
        <path
          className='lb-flame'
          d='M8 31 L-10 27 L-4 31 L-12 35 Z'
          fill='#ffb02e'
        />
        <rect x='6' y='10' width='20' height='5' rx='1.5' fill={look.paint2} />
        <path d='M14 15 L18 27' stroke='#222' strokeWidth='3' />
        <path
          d='M8 36 L18 26 L56 24 L68 15 L88 15 L98 24 L128 29 C138 31 141 37 136 40 L10 41 Z'
          fill={look.paint}
        />
        <path d='M20 33 L130 35' stroke={look.paint2} strokeWidth='2.5' />
        <path d='M70 16 L86 16 L92 24 L64 24 Z' fill='#1b1b1b' />
        <circle
          cx='77'
          cy='16'
          r='6.5'
          fill={look.paint2}
          stroke='#1b1b1b'
          strokeWidth='1.5'
        />
        <path
          d='M77 12.5 L84 15'
          stroke='#1b1b1b'
          strokeWidth='2.4'
          strokeLinecap='round'
        />
        <path
          d='M66 22 C72 12 84 12 92 22'
          stroke='#111'
          strokeWidth='2'
          fill='none'
        />
        <circle
          cx='46'
          cy='31'
          r='7.5'
          fill='#fff'
          stroke='#1b1b1b'
          strokeWidth='1'
        />
        <text
          x='46'
          y='34.6'
          textAnchor='middle'
          fontSize='10'
          fontWeight='900'
          fill='#111'
        >
          {props.number}
        </text>
        <path d='M128 36 L146 38 L146 42 L124 42 Z' fill={look.paint2} />
        <CarWheel cx={32} />
        <CarWheel cx={114} />
      </g>
    </svg>
  )
}

/** The crown the winner wears once the ranks are final. */
export function WinnerCrown() {
  return (
    <svg className='lb-crown' viewBox='0 0 24 20' aria-hidden='true'>
      <path
        d='M2 6 L7 11 L12 2 L17 11 L22 6 L20 17 L4 17 Z'
        fill='#ffcf33'
        stroke='#b97c00'
        strokeWidth='1.2'
        strokeLinejoin='round'
      />
      <circle cx='12' cy='2.5' r='1.8' fill='#ff4d6d' />
      <circle cx='2' cy='6' r='1.5' fill='#4dabff' />
      <circle cx='22' cy='6' r='1.5' fill='#4dabff' />
      <rect x='4' y='15' width='16' height='3' rx='1' fill='#e2a600' />
    </svg>
  )
}

/** The trophy above the first place of the podium. */
export function Trophy() {
  const gradient = useId()
  return (
    <svg className='lb-trophy' viewBox='0 0 64 72' aria-hidden='true'>
      <defs>
        <linearGradient id={gradient} x1='0' x2='1'>
          <stop offset='0' stopColor='#ffe27a' />
          <stop offset='.5' stopColor='#ffc21a' />
          <stop offset='1' stopColor='#d48a00' />
        </linearGradient>
      </defs>
      <path
        d='M14 6 H50 V22 C50 36 42 44 32 44 C22 44 14 36 14 22 Z'
        fill={`url(#${gradient})`}
        stroke='#a86b00'
        strokeWidth='1.5'
      />
      <path
        d='M14 10 H5 C5 22 10 28 17 30'
        stroke='#d48a00'
        strokeWidth='4'
        fill='none'
        strokeLinecap='round'
      />
      <path
        d='M50 10 H59 C59 22 54 28 47 30'
        stroke='#d48a00'
        strokeWidth='4'
        fill='none'
        strokeLinecap='round'
      />
      <rect x='28' y='44' width='8' height='10' fill='#d48a00' />
      <rect x='18' y='54' width='28' height='8' rx='2' fill='#8a5a00' />
      <rect x='14' y='62' width='36' height='6' rx='2' fill='#5c3b00' />
      <path
        d='M24 12 L26 26'
        stroke='#fff6c9'
        strokeWidth='3'
        strokeLinecap='round'
        opacity='.8'
      />
      <text
        x='32'
        y='30'
        textAnchor='middle'
        fontSize='14'
        fontWeight='900'
        fill='#8a5a00'
      >
        1
      </text>
    </svg>
  )
}
