import type { CSSProperties } from 'react'

// Builds the absolute positioning style for the insert menu from its anchor and horizontal alignment.
export const buildInsertMenuStyle = (
  anchor: { x: number; y: number } | null,
  alignX: 'left' | 'center'
): CSSProperties => {
  return {
    top: anchor ? anchor.y : 50,
    left: anchor ? anchor.x : 8,
    transform: alignX === 'center' ? 'translateX(-50%)' : 'none'
  }
}
