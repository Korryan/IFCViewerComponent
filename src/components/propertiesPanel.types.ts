import type { HistoryEntry, OffsetVector, PropertyField, SelectedElement } from '../ifcViewerTypes'

// Describes the public props accepted by the main properties panel.
export type PropertiesPanelProps = {
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
  canTransformSelected: boolean
  transformGuardReason?: string | null
}

// Describes the props accepted by the coordinate editor block inside the properties panel.
export type PropertiesPanelOffsetsProps = {
  selectedElement: SelectedElement
  offsetInputs: OffsetVector
  onOffsetChange: (axis: keyof OffsetVector, value: number) => void
  onApplyOffset: () => void
  onDeleteSelected?: () => void
  deleteLabel?: string
  canTransformSelected: boolean
  transformGuardReason?: string | null
}

// Describes the props accepted by the editable IFC field list inside the properties panel.
export type PropertiesPanelFieldsProps = {
  propertyFields: PropertyField[]
  onFieldChange: (key: string, value: string) => void
}

// Describes the props accepted by the history section inside the properties panel.
export type PropertiesPanelHistoryProps = {
  historyEntries: HistoryEntry[]
}
