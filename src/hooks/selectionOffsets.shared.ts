import type { OffsetVector, Point3D } from '../ifcViewerTypes'

export const BASE_SUBSET_ID = 'base-offset-subset'
export const MOVED_SUBSET_PREFIX = 'moved-offset-'
export const FILTER_SUBSET_PREFIX = 'filter-subset-'
export const SPACE_BIAS_SUBSET_PREFIX = 'space-bias-subset-'
export const SELECTION_SUBSET_PREFIX = 'selection-subset-'
export const zeroOffset: OffsetVector = { dx: 0, dy: 0, dz: 0 }
export const CUBE_BASE_COLOR = 0x4f46e5
export const CUBE_HIGHLIGHT_COLOR = 0xffb100
export const IFC_SELECTION_COLOR = 0xffbf00
export const IFC_SELECTION_EMISSIVE = 0x6a3d00
export const COORD_EPSILON = 1e-4
const COORD_DISPLAY_EPSILON = 1e-3
export const CUSTOM_CUBE_MODEL_ID = -999
export const CUSTOM_HIGHLIGHT_EMISSIVE = 0x6a3d00

// Rounds coordinate values and removes tiny floating-point noise from UI-facing numbers.
export const normalizeCoordinateValue = (value: number): number => {
  if (!Number.isFinite(value)) return 0
  const rounded = Math.round(value * 1000) / 1000
  return Math.abs(rounded) < COORD_DISPLAY_EPSILON ? 0 : rounded
}

// Normalizes every axis of an offset vector for stable storage and display.
export const normalizeOffsetVector = (value: OffsetVector): OffsetVector => ({
  dx: normalizeCoordinateValue(value.dx),
  dy: normalizeCoordinateValue(value.dy),
  dz: normalizeCoordinateValue(value.dz)
})

// Converts a point into the offset-vector shape used by the editor inputs.
export const pointToOffsetVector = (point: Point3D): OffsetVector =>
  normalizeOffsetVector({
    dx: point.x,
    dy: point.y,
    dz: point.z
  })

// Deduplicates IFC ids and coerces them into finite integer express ids.
export const normalizeIfcIds = (ids: number[]): number[] => {
  const dedup = new Set<number>()
  ids.forEach((rawId) => {
    if (!Number.isFinite(rawId)) return
    dedup.add(Math.trunc(rawId))
  })
  return Array.from(dedup)
}
