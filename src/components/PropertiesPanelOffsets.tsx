import { useEffect, useState } from 'react'
import type { OffsetVector } from '../ifcViewerTypes'
import type { PropertiesPanelOffsetsProps } from './propertiesPanel.types'
import { buildDraftOffsets, OFFSET_AXES, tryParseOffsetInput } from './propertiesPanel.utils'

// Renders the coordinate editor block and keeps temporary text input state for partial numeric edits.
export const PropertiesPanelOffsets = ({
  selectedElement,
  offsetInputs,
  onOffsetChange,
  onApplyOffset,
  onDeleteSelected,
  deleteLabel,
  canTransformSelected,
  transformGuardReason
}: PropertiesPanelOffsetsProps) => {
  const [draftOffsets, setDraftOffsets] = useState<Record<keyof OffsetVector, string>>(
    buildDraftOffsets(offsetInputs)
  )

  // This effect resets the coordinate draft state whenever the selected element or resolved offsets change.
  useEffect(() => {
    setDraftOffsets(buildDraftOffsets(offsetInputs))
  }, [offsetInputs, selectedElement.expressID, selectedElement.modelID])

  return (
    <div className="offset-panel">
      <div className="offset-panel__header">
        <h3>Coordinates</h3>
        <span className="offset-panel__units">world</span>
      </div>
      <div className="offset-panel__grid">
        {OFFSET_AXES.map((axis) => (
          <label key={axis} className="offset-panel__field">
            <span>{axis.toUpperCase()}</span>
            <input
              type="text"
              inputMode="decimal"
              value={draftOffsets[axis]}
              disabled={!canTransformSelected}
              onChange={(event) => {
                const rawValue = event.target.value
                setDraftOffsets((prev) => ({
                  ...prev,
                  [axis]: rawValue
                }))
                const parsed = tryParseOffsetInput(rawValue)
                if (parsed !== null) {
                  onOffsetChange(axis, parsed)
                }
              }}
              onBlur={() => {
                const parsed = tryParseOffsetInput(draftOffsets[axis])
                setDraftOffsets((prev) => ({
                  ...prev,
                  [axis]: parsed === null ? String(offsetInputs[axis]) : String(parsed)
                }))
              }}
            />
          </label>
        ))}
      </div>
      <button
        type="button"
        className="offset-panel__apply"
        onClick={onApplyOffset}
        disabled={!canTransformSelected}
      >
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
      {!canTransformSelected && transformGuardReason && (
        <p className="properties-panel__hint">{transformGuardReason}</p>
      )}
    </div>
  )
}
