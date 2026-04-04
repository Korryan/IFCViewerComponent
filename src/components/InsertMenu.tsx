import { useEffect, useRef } from 'react'
import type { InsertPrefabOption } from '../ifcViewerTypes'

type InsertMenuProps = {
  open: boolean
  anchor: { x: number; y: number } | null
  prefabs?: InsertPrefabOption[]
  onInsertPrefab: (prefabId: string) => void
  onUploadClick: () => void
  onCancel: () => void
  alignX?: 'left' | 'center'
}

export const InsertMenu = ({
  open,
  anchor,
  prefabs = [],
  onInsertPrefab,
  onUploadClick,
  onCancel,
  alignX = 'left'
}: InsertMenuProps) => {
  const menuRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return

    const handleOutsidePointerDown = (event: PointerEvent) => {
      const menu = menuRef.current
      const target = event.target as Node | null
      if (!menu || !target || menu.contains(target)) return
      event.preventDefault()
      event.stopPropagation()
      onCancel()
    }

    const handleOutsideClick = (event: MouseEvent) => {
      const menu = menuRef.current
      const target = event.target as Node | null
      if (!menu || !target || menu.contains(target)) return
      event.preventDefault()
      event.stopPropagation()
    }

    document.addEventListener('pointerdown', handleOutsidePointerDown, true)
    document.addEventListener('click', handleOutsideClick, true)

    return () => {
      document.removeEventListener('pointerdown', handleOutsidePointerDown, true)
      document.removeEventListener('click', handleOutsideClick, true)
    }
  }, [onCancel, open])

  if (!open) return null

  return (
    <div
      className="insert-menu-layer"
      onClick={onCancel}
      onPointerDown={onCancel}
    >
      <div
        ref={menuRef}
        className="insert-menu"
        style={{
          top: anchor ? anchor.y : 50,
          left: anchor ? anchor.x : 8,
          transform: alignX === 'center' ? 'translateX(-50%)' : 'none'
        }}
        onClick={(event) => event.stopPropagation()}
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

        <div className="insert-menu__content">
          {prefabs.length > 0 ? (
            <div className="insert-menu__list">
              {prefabs.map((prefab) => (
                <button
                  key={prefab.prefabId}
                  type="button"
                  className="insert-menu__item"
                  onClick={() => onInsertPrefab(prefab.prefabId)}
                  title={`${prefab.fileName} (${prefab.prefabId})`}
                >
                  <span className="insert-menu__item-name">{prefab.fileName}</span>
                  <span className="insert-menu__item-meta">
                    {prefab.prefabId}
                    {prefab.updatedAt ? ` | ${prefab.updatedAt}` : ''}
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <p className="insert-menu__empty">No prefabs uploaded yet.</p>
          )}

          <button type="button" className="insert-menu__upload" onClick={onUploadClick}>
            Upload IFC model
          </button>
        </div>
      </div>
    </div>
  )
}
