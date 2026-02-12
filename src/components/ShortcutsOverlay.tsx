type Shortcut = {
  keys: string
  label: string
}

type ShortcutsOverlayProps = {
  open: boolean
  shortcuts: Shortcut[]
  onClose: () => void
}

// Simple modal overlay for keyboard shortcuts.
export const ShortcutsOverlay = ({ open, shortcuts, onClose }: ShortcutsOverlayProps) => {
  if (!open) return null

  return (
    <div
      className="shortcuts-overlay"
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onClose()
        }
      }}
    >
      <div className="shortcuts-card" role="dialog" aria-modal="true" aria-label="Keyboard shortcuts">
        <header className="shortcuts-card__header">
          <div>
            <h3>Keyboard shortcuts</h3>
            <p>Use these keys to speed up navigation.</p>
          </div>
          <button type="button" className="shortcuts-card__close" onClick={onClose}>
            Close
          </button>
        </header>
        <ul className="shortcuts-list">
          {shortcuts.map((shortcut) => (
            <li key={shortcut.keys} className="shortcuts-item">
              <span className="shortcuts-keys">{shortcut.keys}</span>
              <span className="shortcuts-label">{shortcut.label}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
