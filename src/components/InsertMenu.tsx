import type { PointerEvent as ReactPointerEvent } from 'react'
import { InsertMenuList } from './InsertMenuList'
import type { InsertMenuProps } from './insertMenu.types'
import { buildInsertMenuStyle } from './insertMenu.utils'

// Renders the add-object overlay anchored inside the viewer or object-tree panel.
export const InsertMenu = ({
  open,
  anchor,
  prefabs = [],
  onInsertPrefab,
  onUploadClick,
  onCancel,
  alignX = 'left'
}: InsertMenuProps) => {
  if (!open) return null

  // This function closes the menu only when the backdrop itself receives the pointer event.
  const handleBackdropPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return
    onCancel()
  }

  return (
    <div
      className="insert-menu-layer"
      onPointerDown={handleBackdropPointerDown}
    >
      <div
        className="insert-menu"
        style={buildInsertMenuStyle(anchor, alignX)}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <div className="insert-menu__header">
          <div>
            <h3>Add object</h3>
            <p>Choose a saved prefab or upload a one-off IFC model.</p>
          </div>
          <button type="button" className="insert-menu__close" onClick={onCancel}>
            Close
          </button>
        </div>

        <InsertMenuList
          prefabs={prefabs}
          onInsertPrefab={onInsertPrefab}
          onUploadClick={onUploadClick}
        />
      </div>
    </div>
  )
}
