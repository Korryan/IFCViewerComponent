import type { InsertMenuListProps } from './insertMenu.types'

// Renders the prefab choices and one-off upload action shown inside the insert menu.
export const InsertMenuList = ({
  prefabs,
  onInsertPrefab,
  onUploadClick
}: InsertMenuListProps) => {
  return (
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
  )
}
