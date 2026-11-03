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
/** Colors of one lane's horse and rider, or its car. */
export type RunnerLook = {
  coat: string
  coatFar: string
  mane: string
  silk: string
  silk2: string
  paint: string
  paint2: string
}

/** Each lane keeps its colors, so a runner is recognizable as it moves. */
export const LANE_LOOKS: RunnerLook[] = [
  {
    coat: '#a0582a',
    coatFar: '#7b411d',
    mane: '#4a2510',
    silk: '#f2b705',
    silk2: '#c0392b',
    paint: '#e10600',
    paint2: '#ffd400',
  },
  {
    coat: '#cfc8bf',
    coatFar: '#a69e94',
    mane: '#6d665f',
    silk: '#2f7de1',
    silk2: '#ffffff',
    paint: '#00a19c',
    paint2: '#ffffff',
  },
  {
    coat: '#5b3a26',
    coatFar: '#3f2819',
    mane: '#1d120a',
    silk: '#ff5d8f',
    silk2: '#ffe066',
    paint: '#ff8000',
    paint2: '#1b1b1b',
  },
]
