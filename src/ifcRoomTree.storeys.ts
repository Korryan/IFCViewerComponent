import type { ObjectTree } from './ifcViewerTypes'
import type { IfcViewerAPI } from './viewer/IfcViewerAPICompat'

// Describes the normalized metadata shown for one IFC storey node.
export type StoreyInfo = {
  elevation: number | null
  name: string | null
  longName: string | null
}

// Unwraps nested IFC scalar containers until a primitive value or unknown payload remains.
const normalizeIfcScalar = (value: unknown): unknown => {
  if (value && typeof value === 'object' && 'value' in (value as Record<string, unknown>)) {
    return normalizeIfcScalar((value as { value?: unknown }).value)
  }
  return value
}

// Reads one optional IFC string scalar and returns its trimmed string form when present.
const readIfcString = (value: unknown): string | null => {
  const normalized = normalizeIfcScalar(value)
  if (typeof normalized !== 'string') return null
  const trimmed = normalized.trim()
  return trimmed.length > 0 ? trimmed : null
}

// Reads one optional IFC numeric scalar and returns a finite number when possible.
const readIfcNumber = (value: unknown): number | null => {
  const normalized = normalizeIfcScalar(value)
  if (typeof normalized === 'number' && Number.isFinite(normalized)) {
    return normalized
  }
  if (typeof normalized === 'string' && normalized.trim().length > 0) {
    const parsed = Number(normalized)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

// Builds the normalized storey metadata lookup for every storey node present in the IFC tree.
export const buildStoreyInfoMap = async (
  viewer: IfcViewerAPI,
  tree: ObjectTree,
  modelID: number
): Promise<Map<string, StoreyInfo>> => {
  const storeys = Object.values(tree.nodes).filter(
    (node) => node.nodeType === 'ifc' && node.expressID !== null && node.type.toUpperCase() === 'IFCBUILDINGSTOREY'
  )
  if (storeys.length === 0) {
    return new Map()
  }

  const entries = await Promise.all(
    storeys.map(async (storey) => {
      try {
        const properties = await viewer.IFC.getProperties(modelID, storey.expressID!, false, false)
        return [
          storey.id,
          {
            elevation:
              readIfcNumber(properties?.Elevation) ??
              readIfcNumber(properties?.elevation) ??
              null,
            name: readIfcString(properties?.Name) ?? readIfcString(properties?.name) ?? storey.name ?? null,
            longName:
              readIfcString(properties?.LongName) ??
              readIfcString(properties?.longName) ??
              null
          } satisfies StoreyInfo
        ] as const
      } catch (err) {
        console.warn('Failed to read storey info for element', storey.expressID, err)
        return [
          storey.id,
          {
            elevation: null,
            name: storey.name ?? null,
            longName: null
          } satisfies StoreyInfo
        ] as const
      }
    })
  )

  return new Map(entries)
}
