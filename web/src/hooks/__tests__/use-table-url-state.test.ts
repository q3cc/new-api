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
import { act, renderHook } from '@testing-library/react'
import { expect, it, vi } from 'vitest'

import { useTableUrlState } from '../use-table-url-state'

function renderUrlState(initialSearch: Record<string, unknown>) {
  const navigate = vi.fn()
  const view = renderHook(
    (props: { search: Record<string, unknown> }) =>
      useTableUrlState({
        search: props.search,
        navigate,
        globalFilter: { enabled: true, key: 'filter' },
      }),
    { initialProps: { search: initialSearch } }
  )
  return { ...view, navigate }
}

it('updates the global filter when the URL filter is changed by navigation', () => {
  const view = renderUrlState({ filter: 'alice' })
  expect(view.result.current.globalFilter).toBe('alice')

  view.rerender({ search: { filter: 'seed_user03' } })

  expect(view.result.current.globalFilter).toBe('seed_user03')
})

it('clears the global filter when the URL filter is removed', () => {
  const view = renderUrlState({ filter: 'alice' })

  view.rerender({ search: {} })

  expect(view.result.current.globalFilter).toBe('')
})

it('keeps the typed filter and writes it to the URL when the user searches', () => {
  const view = renderUrlState({})

  act(() => view.result.current.onGlobalFilterChange?.('  bob  '))

  expect(view.result.current.globalFilter).toBe('bob')
  const update = view.navigate.mock.calls[0][0].search as (
    prev: Record<string, unknown>
  ) => Record<string, unknown>
  expect(update({ page: 3 })).toEqual({ page: undefined, filter: 'bob' })
})

it('writes selected array column filters to the URL and drops empty ones', () => {
  const navigate = vi.fn()
  // Router search objects are stable between renders; a fresh literal per
  // render would re-trigger the URL sync effect forever.
  const search = {}
  const { result } = renderHook(() =>
    useTableUrlState({
      search,
      navigate,
      columnFilters: [
        { columnId: 'status', searchKey: 'status', type: 'array' },
        { columnId: 'role', searchKey: 'role', type: 'array' },
      ],
    })
  )

  act(() =>
    result.current.onColumnFiltersChange([
      { id: 'status', value: ['1', '2'] },
      { id: 'role', value: [] },
    ])
  )

  const update = navigate.mock.calls[0][0].search as (
    prev: Record<string, unknown>
  ) => Record<string, unknown>
  expect(update({ page: 2, role: ['10'] })).toEqual({
    page: undefined,
    status: ['1', '2'],
    role: undefined,
  })
})
