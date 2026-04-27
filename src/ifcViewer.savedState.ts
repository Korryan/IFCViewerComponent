import { CUBE_ITEM_PREFIX } from './ifcViewer.constants'
import type { HistoryEntry, MetadataEntry } from './ifcViewerTypes'

// Sanitizes one optional vector-like object into a finite numeric triple or undefined.
const sanitizeVector = (
  value:
    | {
        x: unknown
        y: unknown
        z: unknown
      }
    | null
    | undefined
) => {
  if (!value) return undefined
  if (!Number.isFinite(value.x) || !Number.isFinite(value.y) || !Number.isFinite(value.z)) {
    return undefined
  }
  return {
    x: Number(value.x),
    y: Number(value.y),
    z: Number(value.z)
  }
}

// Parses one persisted cube item id into its numeric custom-object express id.
export const parseCubeId = (id: string): number | null => {
  const trimmed = id.trim()
  if (!trimmed) return null

  if (trimmed.startsWith(CUBE_ITEM_PREFIX)) {
    const parsed = Number(trimmed.slice(CUBE_ITEM_PREFIX.length))
    return Number.isFinite(parsed) ? parsed : null
  }

  const legacyMatch = trimmed.match(/(?:cube[-_:]?)?(\d+)$/i)
  if (!legacyMatch) return null

  const parsed = Number(legacyMatch[1])
  return Number.isFinite(parsed) ? parsed : null
}

// Sanitizes metadata entries loaded from persisted state into the shapes used by the editor.
export const sanitizeMetadataEntries = (entries: MetadataEntry[]): MetadataEntry[] => {
  return entries
    .filter((entry) => entry && typeof entry.ifcId === 'number')
    .map((entry) => {
      const sanitizedCustom: Record<string, string> = {}
      if (entry.custom) {
        Object.entries(entry.custom).forEach(([key, value]) => {
          if (typeof value === 'string') {
            sanitizedCustom[key] = value
          }
        })
      }

      return {
        ...entry,
        type: typeof entry.type === 'string' ? entry.type : undefined,
        custom: sanitizedCustom,
        moveDelta: sanitizeVector(entry.moveDelta),
        rotation: sanitizeVector(entry.rotation),
        rotateDelta: sanitizeVector(entry.rotateDelta)
      }
    })
}

// Sanitizes history entries loaded from persisted state into the shapes used by the editor.
export const sanitizeHistoryEntries = (entries: HistoryEntry[]): HistoryEntry[] => {
  return entries
    .filter((entry) => entry && typeof entry.ifcId === 'number' && typeof entry.label === 'string')
    .map((entry) => ({
      ...entry,
      timestamp: typeof entry.timestamp === 'string' ? entry.timestamp : new Date().toISOString()
    }))
}
