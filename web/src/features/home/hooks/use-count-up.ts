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
import { useEffect, useState } from 'react'

const EASE_OUT_CUBIC = (progress: number) => 1 - (1 - progress) ** 3

/**
 * Counts from zero to `target` once the value becomes available.
 * Returns null while the target is unknown so callers can render a placeholder.
 */
export function useCountUp(
  target: number | null,
  duration = 1200
): number | null {
  const [value, setValue] = useState<number | null>(null)

  useEffect(() => {
    if (target === null) {
      setValue(null)
      return
    }
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setValue(target)
      return
    }

    let frame = 0
    const start = performance.now()
    const step = (now: number) => {
      const progress = Math.min((now - start) / duration, 1)
      setValue(Math.round(target * EASE_OUT_CUBIC(progress)))
      if (progress < 1) {
        frame = requestAnimationFrame(step)
      }
    }
    frame = requestAnimationFrame(step)

    return () => cancelAnimationFrame(frame)
  }, [target, duration])

  return value
}
