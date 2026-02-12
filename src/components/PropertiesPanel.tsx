import type { HistoryEntry, OffsetVector, PropertyField, SelectedElement } from '../ifcViewerTypes'

type PropertiesPanelProps = {
  selectedElement: SelectedElement | null
  isFetchingProperties: boolean
  propertyError: string | null
  offsetInputs: OffsetVector
  onOffsetChange: (axis: keyof OffsetVector, value: number) => void
  onApplyOffset: () => void
  onDeleteSelected?: () => void
  deleteLabel?: string
  shortcutsHint?: string
  onShowShortcuts?: () => void
  elementName?: string | null
  historyEntries?: HistoryEntry[]
  propertyFields: PropertyField[]
  onFieldChange: (key: string, value: string) => void
}

// Right-hand side inspector for coordinates and editable IFC properties
export const PropertiesPanel = ({
  selectedElement,
  isFetchingProperties,
  propertyError,
  offsetInputs,
  onOffsetChange,
  onApplyOffset,
  onDeleteSelected,
  deleteLabel,
  shortcutsHint,
  onShowShortcuts,
  elementName,
  historyEntries = [],
  propertyFields,
  onFieldChange
}: PropertiesPanelProps) => {
  return (
    <aside className="properties-panel">
      <header className="properties-panel__header">
        <h2>{elementName || 'Element properties'}</h2>
        {selectedElement && (
          <p className="properties-panel__meta">
            #{selectedElement.expressID}
            {selectedElement.type ? ` - ${selectedElement.type}` : ''}
          </p>
        )}
        {elementName && <p className="properties-panel__meta">Element properties</p>}
      </header>
      <div className="properties-panel__content">
        {shortcutsHint && (
          <p className="properties-panel__hint">
            {shortcutsHint}
            {onShowShortcuts && (
              <button
                type="button"
                className="properties-panel__link"
                onClick={onShowShortcuts}
              >
                View
              </button>
            )}
          </p>
        )}
        {isFetchingProperties && <p className="properties-panel__status">Loading properties...</p>}
        {propertyError && (
          <p className="properties-panel__status properties-panel__status--error">{propertyError}</p>
        )}
        {!isFetchingProperties && !propertyError && !selectedElement && (
          <p className="properties-panel__status">
            Click any element in the scene to inspect and edit its metadata.
          </p>
        )}
        {!isFetchingProperties && !propertyError && selectedElement && (
          <>
            <div className="offset-panel">
              <div className="offset-panel__header">
                <h3>Coordinates</h3>
                <span className="offset-panel__units">world</span>
              </div>
              <div className="offset-panel__grid">
                {(['dx', 'dy', 'dz'] as Array<keyof OffsetVector>).map((axis) => (
                  <label key={axis} className="offset-panel__field">
                    <span>{axis.toUpperCase()}</span>
                    <input
                      type="number"
                      step="0.01"
                      value={offsetInputs[axis]}
                      onChange={(event) =>
                        onOffsetChange(
                          axis,
                          Number.isFinite(parseFloat(event.target.value))
                            ? parseFloat(event.target.value)
                            : 0
                        )
                      }
                    />
                  </label>
                ))}
              </div>
              <button type="button" className="offset-panel__apply" onClick={onApplyOffset}>
                Apply coordinates
              </button>
              {onDeleteSelected && (
                <button
                  type="button"
                  className="offset-panel__apply"
                  onClick={onDeleteSelected}
                >
                  {deleteLabel ?? 'Delete'}
                </button>
              )}
              <p className="properties-panel__hint">
                Coordinates show the bottom center of the element bounding box.
              </p>
            </div>
            <form className="properties-form">
              {propertyFields.length > 0 ? (
                propertyFields.map((field) => {
                  const isLongValue = field.value.length > 60 || field.value.includes('\n')
                  return (
                    <label key={field.key} className="properties-form__field">
                      <span>{field.label}</span>
                      {isLongValue ? (
                        <textarea
                          value={field.value}
                          onChange={(event) => onFieldChange(field.key, event.target.value)}
                          rows={Math.min(6, Math.max(2, Math.ceil(field.value.length / 60)))}
                        />
                      ) : (
                        <input
                          type="text"
                          value={field.value}
                          onChange={(event) => onFieldChange(field.key, event.target.value)}
                        />
                      )}
                    </label>
                  )
                })
              ) : (
                <p className="properties-panel__status">
                  This element does not expose any simple IFC attributes.
                </p>
              )}
            </form>
            <div className="history-panel">
              <div className="history-panel__header">
                <h3>History</h3>
              </div>
              {historyEntries.length > 0 ? (
                <ul className="history-panel__list">
                  {historyEntries.map((entry, index) => (
                    <li key={`${entry.timestamp}-${index}`} className="history-panel__item">
                      <span className="history-panel__label">{entry.label}</span>
                      <span className="history-panel__time">
                        {new Date(entry.timestamp).toLocaleString()}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="properties-panel__status">No history yet.</p>
              )}
            </div>
            <p className="properties-panel__hint">
              Changes are saved to the local REST API (file-backed).
            </p>
          </>
        )}
      </div>
    </aside>
  )
}
