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
import { useQuery } from '@tanstack/react-query'

import { activitiesListQuery } from '../api'
import { isJoinableActivity } from '../lib/activity-state'
import { useNowSeconds } from './use-now-seconds'

/**
 * Whether the user can take part in some activity right now. The sidebar
 * shows a badge on the Activities entry while this holds; `enabled` is false
 * when that entry is hidden, so the list is not loaded for nothing.
 */
export function useHasJoinableActivity(enabled: boolean): boolean {
  const nowSeconds = useNowSeconds()
  const { data } = useQuery({
    ...activitiesListQuery,
    enabled,
    meta: { errorToast: false },
  })
  return (data ?? []).some((activity) =>
    isJoinableActivity(activity, nowSeconds)
  )
}
