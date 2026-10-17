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
import { useEffect, useRef } from 'react'

/** Tracks local light on one surface, or delegates to matching descendants. */
export function usePointerShine<T extends HTMLElement>(selector?: string) {
  const ref = useRef<T>(null)

  useEffect(() => {
    const root = ref.current
    if (!root) return
    const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)')
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
    let active: HTMLElement | null = null

    const resetShine = () => {
      if (!active) return
      active.style.setProperty('--shine-x', '50%')
      active.style.setProperty('--shine-y', '34%')
      active.style.setProperty('--shine-angle', '145deg')
      active = null
    }

    const handlePointerMove = (event: PointerEvent) => {
      if (
        !finePointer.matches ||
        reducedMotion.matches ||
        event.pointerType !== 'mouse'
      ) {
        return
      }
      const target = event.target instanceof Element ? event.target : null
      const surface = selector ? target?.closest<HTMLElement>(selector) : root
      if (!surface || !root.contains(surface)) {
        resetShine()
        return
      }
      if (active !== surface) resetShine()
      const rect = surface.getBoundingClientRect()
      if (!rect.width || !rect.height) return
      active = surface
      const x = ((event.clientX - rect.left) / rect.width) * 100
      const y = ((event.clientY - rect.top) / rect.height) * 100
      // CSS gradient angles are clockwise from the top, not from the +x axis.
      const angle = 90 + (Math.atan2(y - 50, x - 50) * 180) / Math.PI
      surface.style.setProperty(
        '--shine-x',
        `${Math.min(100, Math.max(0, x))}%`
      )
      surface.style.setProperty(
        '--shine-y',
        `${Math.min(100, Math.max(0, y))}%`
      )
      surface.style.setProperty('--shine-angle', `${angle.toFixed(1)}deg`)
    }
    const handlePointerOut = (event: PointerEvent) => {
      if (
        event.relatedTarget instanceof Node &&
        active?.contains(event.relatedTarget)
      ) {
        return
      }
      resetShine()
    }

    root.addEventListener('pointermove', handlePointerMove, { passive: true })
    root.addEventListener('pointerout', handlePointerOut)
    root.addEventListener('pointerleave', resetShine)
    root.addEventListener('pointercancel', resetShine)
    finePointer.addEventListener('change', resetShine)
    reducedMotion.addEventListener('change', resetShine)
    return () => {
      resetShine()
      root.removeEventListener('pointermove', handlePointerMove)
      root.removeEventListener('pointerout', handlePointerOut)
      root.removeEventListener('pointerleave', resetShine)
      root.removeEventListener('pointercancel', resetShine)
      finePointer.removeEventListener('change', resetShine)
      reducedMotion.removeEventListener('change', resetShine)
    }
  }, [selector])

  return ref
}
