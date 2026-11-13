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
import { Layers, Shapes } from 'lucide-react'

import { getGroupTag, MIXED_GROUP_TAG } from '@/lib/group-tag'
import { getLobeIcon } from '@/lib/lobe-icon'

/** The decorative icon of a group tag: its provider logo, or a generic one. */
export function GroupTagIcon(props: { tag: string; size?: number }) {
  const size = props.size ?? 16
  const tag = getGroupTag(props.tag)
  if (tag.icon) {
    return (
      <span aria-hidden='true' className='flex shrink-0 items-center'>
        {getLobeIcon(tag.icon, size)}
      </span>
    )
  }
  const Icon = tag.id === MIXED_GROUP_TAG ? Layers : Shapes
  return (
    <Icon
      aria-hidden='true'
      className='text-muted-foreground shrink-0'
      style={{ width: size, height: size }}
    />
  )
}
