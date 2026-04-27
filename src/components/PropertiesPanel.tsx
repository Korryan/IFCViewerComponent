import type { PropertiesPanelProps } from './propertiesPanel.types'
import { PropertiesPanelFields } from './PropertiesPanelFields'
import { PropertiesPanelHistory } from './PropertiesPanelHistory'
import { PropertiesPanelOffsets } from './PropertiesPanelOffsets'

// Renders the right-hand inspector for coordinates, metadata, and history of the current selection.
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
  onFieldChange,
  canTransformSelected,
  transformGuardReason
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
            <PropertiesPanelOffsets
              selectedElement={selectedElement}
              offsetInputs={offsetInputs}
              onOffsetChange={onOffsetChange}
              onApplyOffset={onApplyOffset}
              onDeleteSelected={onDeleteSelected}
              deleteLabel={deleteLabel}
              canTransformSelected={canTransformSelected}
              transformGuardReason={transformGuardReason}
            />
            <PropertiesPanelFields
              propertyFields={propertyFields}
              onFieldChange={onFieldChange}
            />
            <PropertiesPanelHistory historyEntries={historyEntries} />
            <p className="properties-panel__hint">
              Changes are saved to the local REST API (file-backed).
            </p>
          </>
        )}
      </div>
    </aside>
  )
}
