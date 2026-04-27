import {
  INVERSE_COORDINATION_MATRIX_CUSTOM_KEY,
  MOVE_DELTA_CUSTOM_KEY,
  PLACEMENT_POSITION_CUSTOM_KEY,
  POSITION_EPSILON,
  ROTATE_DELTA_CUSTOM_KEY,
  ROTATION_EPSILON
} from './ifcViewer.constants'
import type { MetadataEntry, Point3D } from './ifcViewerTypes'

type EntryWithCustom = {
  custom?: Record<string, string>
}

type MoveDelta = {
  dx: number
  dy: number
  dz: number
}

// This serializes an inverse coordination matrix only when it has the expected IFC transform shape.
export const serializeInverseCoordinationMatrix = (
  matrix: number[] | null | undefined
): string | null => {
  if (!Array.isArray(matrix) || matrix.length !== 16) {
    return null
  }
  return JSON.stringify(matrix)
}

// This backfills the inverse coordination matrix onto entries that do not have it yet.
export const injectMissingInverseCoordinationMatrix = <T extends EntryWithCustom>(
  entries: T[],
  serializedMatrix: string
): T[] => {
  let changed = false
  const next = entries.map((entry) => {
    const existingValue = entry.custom?.[INVERSE_COORDINATION_MATRIX_CUSTOM_KEY]
    if (typeof existingValue === 'string' && existingValue.trim()) {
      return entry
    }
    changed = true
    return {
      ...entry,
      custom: {
        ...(entry.custom ?? {}),
        [INVERSE_COORDINATION_MATRIX_CUSTOM_KEY]: serializedMatrix
      }
    }
  })
  return changed ? next : entries
}

// This restores the last stored translation delta so subsequent moves stay cumulative.
const parseStoredMoveDelta = (entry: MetadataEntry): MoveDelta => {
  const raw = entry.custom?.[MOVE_DELTA_CUSTOM_KEY]
  if (!raw) {
    return { dx: 0, dy: 0, dz: 0 }
  }
  try {
    const parsed = JSON.parse(raw) as { dx?: number; dy?: number; dz?: number }
    return {
      dx: Number.isFinite(parsed.dx) ? Number(parsed.dx) : 0,
      dy: Number.isFinite(parsed.dy) ? Number(parsed.dy) : 0,
      dz: Number.isFinite(parsed.dz) ? Number(parsed.dz) : 0
    }
  } catch {
    return { dx: 0, dy: 0, dz: 0 }
  }
}

// This compares two world positions using the same tolerance as the viewer transform tools.
const hasSamePosition = (left: Point3D | undefined, right: Point3D): boolean =>
  Boolean(
    left &&
      Math.abs(left.x - right.x) < POSITION_EPSILON &&
      Math.abs(left.y - right.y) < POSITION_EPSILON &&
      Math.abs(left.z - right.z) < POSITION_EPSILON
  )

// This compares two rotations using the same tolerance as the viewer transform tools.
const hasSameRotation = (left: Point3D | undefined, right: Point3D): boolean =>
  Boolean(
    left &&
      Math.abs(left.x - right.x) < ROTATION_EPSILON &&
      Math.abs(left.y - right.y) < ROTATION_EPSILON &&
      Math.abs(left.z - right.z) < ROTATION_EPSILON
  )

// This builds the persisted metadata snapshot for one IFC element after an in-view transform.
export const buildUpdatedIfcMetadataEntry = (args: {
  existing: MetadataEntry
  ifcId: number
  resolvedType?: string
  resolvedPosition: Point3D
  basePosition: Point3D
  translationDelta?: Point3D | null
  rotationDelta?: Point3D | null
  placementPosition?: Point3D | null
  inverseCoordinationMatrix?: number[] | null
}): MetadataEntry => {
  const {
    existing,
    ifcId,
    resolvedType,
    resolvedPosition,
    basePosition,
    translationDelta,
    rotationDelta,
    placementPosition,
    inverseCoordinationMatrix
  } = args

  const previousDelta = parseStoredMoveDelta(existing)
  const nextDelta = translationDelta
    ? {
        dx: translationDelta.x,
        dy: translationDelta.y,
        dz: translationDelta.z
      }
    : existing.position
      ? {
          dx: previousDelta.dx + (resolvedPosition.x - existing.position.x),
          dy: previousDelta.dy + (resolvedPosition.y - existing.position.y),
          dz: previousDelta.dz + (resolvedPosition.z - existing.position.z)
        }
      : {
          dx: resolvedPosition.x - basePosition.x,
          dy: resolvedPosition.y - basePosition.y,
          dz: resolvedPosition.z - basePosition.z
        }

  const nextRotation = rotationDelta
    ? {
        x: rotationDelta.x,
        y: rotationDelta.y,
        z: rotationDelta.z
      }
    : {
        x: 0,
        y: 0,
        z: 0
      }

  const moveDeltaJson = JSON.stringify(nextDelta)
  const rotateDeltaJson = JSON.stringify(nextRotation)
  const placementPositionJson = placementPosition ? JSON.stringify(placementPosition) : null
  const inverseCoordinationMatrixJson = serializeInverseCoordinationMatrix(inverseCoordinationMatrix)
  const nextType = typeof resolvedType === 'string' ? resolvedType : existing.type
  const currentDeltaJson = existing.custom?.[MOVE_DELTA_CUSTOM_KEY]
  const currentRotateDeltaJson = existing.custom?.[ROTATE_DELTA_CUSTOM_KEY]
  const currentPlacementPositionJson = existing.custom?.[PLACEMENT_POSITION_CUSTOM_KEY]
  const currentInverseCoordinationJson = existing.custom?.[INVERSE_COORDINATION_MATRIX_CUSTOM_KEY]
  const placementChanged = placementPositionJson
    ? currentPlacementPositionJson !== placementPositionJson
    : false
  const coordinationMatrixChanged = inverseCoordinationMatrixJson
    ? currentInverseCoordinationJson !== inverseCoordinationMatrixJson
    : false

  if (
    hasSamePosition(existing.position, resolvedPosition) &&
    hasSameRotation(existing.rotation, nextRotation) &&
    existing.type === nextType &&
    currentDeltaJson === moveDeltaJson &&
    currentRotateDeltaJson === rotateDeltaJson &&
    !placementChanged &&
    !coordinationMatrixChanged
  ) {
    return existing
  }

  return {
    ...existing,
    ifcId,
    type: nextType,
    position: resolvedPosition,
    moveDelta: {
      x: nextDelta.dx,
      y: nextDelta.dy,
      z: nextDelta.dz
    },
    rotation: nextRotation,
    rotateDelta: nextRotation,
    custom: {
      ...(existing.custom ?? {}),
      [MOVE_DELTA_CUSTOM_KEY]: moveDeltaJson,
      [ROTATE_DELTA_CUSTOM_KEY]: rotateDeltaJson,
      ...(placementPositionJson
        ? { [PLACEMENT_POSITION_CUSTOM_KEY]: placementPositionJson }
        : {}),
      ...(inverseCoordinationMatrixJson
        ? { [INVERSE_COORDINATION_MATRIX_CUSTOM_KEY]: inverseCoordinationMatrixJson }
        : {})
    }
  }
}
