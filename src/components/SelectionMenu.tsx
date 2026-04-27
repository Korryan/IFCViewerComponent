import { useRef } from 'react'
import { usePointerDownOutside } from './usePointerDownOutside'

type SelectionCandidate = {
  id: string
  label: string
  meta?: string
}

type SelectionMenuProps = {
  open: boolean
  anchor: { x: number; y: number } | null
  candidates: SelectionCandidate[]
  onSelect: (candidateId: string) => void
  onCancel: () => void
}

// Context menu used to choose from multiple overlapping picks.
export const SelectionMenu = ({
  open,
  anchor,
  candidates,
  onSelect,
  onCancel
}: SelectionMenuProps) => {
  const menuRef = useRef<HTMLDivElement | null>(null)
  usePointerDownOutside(open, menuRef, onCancel)

  if (!open || !anchor || candidates.length === 0) return null

  return (
    <div
      ref={menuRef}
      className="selection-menu"
      style={{ left: anchor.x, top: anchor.y }}
      role="menu"
    >
      <header className="selection-menu__header">
        <h3>Pick overlapping</h3>
        <button type="button" className="selection-menu__close" onClick={onCancel}>
          Close
        </button>
      </header>
      <ul className="selection-menu__list">
        {candidates.map((candidate) => (
          <li key={candidate.id} className="selection-menu__item">
            <button type="button" onClick={() => onSelect(candidate.id)}>
              <span className="selection-menu__label">{candidate.label}</span>
              {candidate.meta && (
                <span className="selection-menu__meta">{candidate.meta}</span>
              )}
            </button>
          </li>
        ))}
      </ul>
      <p className="selection-menu__hint">Press Esc to cancel.</p>
    </div>
  )
}
