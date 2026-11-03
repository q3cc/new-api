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
import type { LeaderboardRow, LotteryLeaderboardStyle } from '../../types'
import { PodiumScene } from './podium-scene'
import { RaceScene } from './race-scene'

type LeaderboardSceneProps = {
  style: Exclude<LotteryLeaderboardStyle, 'plain'>
  rows: LeaderboardRow[]
  meRank: number
  final: boolean
  running: boolean
  formatScore: (score: number) => string
}

/** The top three of a leaderboard in the style the activity chose. */
export function LeaderboardScene(props: LeaderboardSceneProps) {
  const top = props.rows.filter((row) => row.rank <= 3)
  if (props.style === 'podium') {
    return (
      <PodiumScene
        rows={top}
        meRank={props.meRank}
        final={props.final}
        running={props.running}
        formatScore={props.formatScore}
      />
    )
  }
  return (
    <RaceScene
      key={props.style}
      kind={props.style}
      rows={top}
      meRank={props.meRank}
      final={props.final}
      running={props.running}
      formatScore={props.formatScore}
    />
  )
}
