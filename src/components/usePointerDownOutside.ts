import { useEffect } from 'react'
import type { RefObject } from 'react'

// Closes one overlay when a pointer-down event lands outside the referenced element.
export const usePointerDownOutside = (
  open: boolean,
  ref: RefObject<HTMLElement | null>,
  onCancel: () => void
) => {
  useEffect(() => {
    if (!open) return

    const handlePointerDown = (event: PointerEvent) => {
      const container = ref.current
      const target = event.target as Node | null
      if (!container || !target || container.contains(target)) return
      onCancel()
    }

    window.addEventListener('pointerdown', handlePointerDown)
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown)
    }
  }, [onCancel, open, ref])
}
