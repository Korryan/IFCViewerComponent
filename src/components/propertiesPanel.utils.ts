import type { HistoryEntry, OffsetVector, PropertyField } from '../ifcViewerTypes'

// Lists the offset axes rendered by the coordinate editor in stable display order.
export const OFFSET_AXES: Array<keyof OffsetVector> = ['dx', 'dy', 'dz']

// Parses one free-form coordinate input into a finite number or returns null for incomplete text.
export const tryParseOffsetInput = (rawValue: string): number | null => {
  const normalized = rawValue.replace(',', '.').trim()
  if (!normalized || normalized === '-' || normalized === '.' || normalized === '-.') {
    return null
  }
  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : null
}

// Returns whether one property field should render as a multiline textarea instead of a text input.
export const shouldUseMultilineField = (field: PropertyField) => {
  return field.value.length > 60 || field.value.includes('\n')
}

// Builds the default draft coordinate state from the currently resolved offset inputs.
export const buildDraftOffsets = (offsetInputs: OffsetVector): Record<keyof OffsetVector, string> => {
  return {
    dx: String(offsetInputs.dx),
    dy: String(offsetInputs.dy),
    dz: String(offsetInputs.dz)
  }
}

// Formats one history entry timestamp using the current browser locale.
export const formatHistoryTimestamp = (entry: HistoryEntry) => {
  return new Date(entry.timestamp).toLocaleString()
}
