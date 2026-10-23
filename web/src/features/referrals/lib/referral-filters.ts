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
import type { NavigateFn } from '@/hooks/use-table-url-state'

import { referralsSearchSchema, type ReferralsSearch } from '../api'

/** Sets referral filters and returns to the first page. */
export function changeReferralFilters(
  navigate: NavigateFn,
  patch: Partial<ReferralsSearch>
) {
  navigate({
    search: (prev) =>
      referralsSearchSchema.parse({ ...prev, ...patch, page: 1 }),
    replace: true,
  })
}
