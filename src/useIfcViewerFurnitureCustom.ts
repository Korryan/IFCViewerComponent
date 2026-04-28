import { type Dispatch, type MutableRefObject, type SetStateAction, useCallback, useEffect } from 'react'
import {
  INVERSE_COORDINATION_MATRIX_CUSTOM_KEY,
  SPACE_RELATIVE_POSITION_CUSTOM_KEY
} from './ifcViewer.constants'
import { injectMissingInverseCoordinationMatrix, serializeInverseCoordinationMatrix } from './ifcViewer.persistence'
import type { FurnitureItem, MetadataEntry, Point3D } from './ifcViewerTypes'

type ViewerPositionResolverArgs = {
  activeModelId: number | null
  activeModelInverseCoordinationMatrixRef: MutableRefObject<number[] | null>
  getElementWorldPosition: (modelID: number, expressID: number) => Point3D | null
  getIfcElementPlacementPosition: (modelID: number, expressID: number) => Point3D | null
  ensureIfcPlacementPosition: (modelID: number, expressID: number) => Promise<Point3D | null>
}

type UseIfcViewerInverseMatrixBackfillArgs = {
  activeModelId: number | null
  activeModelInverseCoordinationMatrixRef: MutableRefObject<number[] | null>
  setFurnitureEntries: Dispatch<SetStateAction<FurnitureItem[]>>
  setMetadataEntries: Dispatch<SetStateAction<MetadataEntry[]>>
}

// Builds the persisted custom payload for inserted objects from the current viewer state.
export const useIfcViewerBuildFurnitureCustom = ({
  activeModelId,
  activeModelInverseCoordinationMatrixRef,
  getElementWorldPosition,
  getIfcElementPlacementPosition,
  ensureIfcPlacementPosition
}: ViewerPositionResolverArgs) => {
  // This prepares the persisted custom payload for inserted objects from the current viewer state.
  const buildFurnitureCustom = useCallback(
    async (args?: {
      position?: { x: number; y: number; z: number } | null
      spaceIfcId?: number | null
      extraCustom?: Record<string, string>
    }) => {
      const custom: Record<string, string> = { ...(args?.extraCustom ?? {}) }
      const serializedInverseMatrix = serializeInverseCoordinationMatrix(
        activeModelInverseCoordinationMatrixRef.current
      )
      if (serializedInverseMatrix) {
        custom[INVERSE_COORDINATION_MATRIX_CUSTOM_KEY] = serializedInverseMatrix
      }

      const position = args?.position ?? null
      const spaceIfcId = args?.spaceIfcId ?? null
      if (
        position &&
        typeof activeModelId === 'number' &&
        Number.isFinite(spaceIfcId) &&
        spaceIfcId !== null
      ) {
        const spacePosition =
          getElementWorldPosition(activeModelId, spaceIfcId) ??
          getIfcElementPlacementPosition(activeModelId, spaceIfcId) ??
          (await ensureIfcPlacementPosition(activeModelId, spaceIfcId))
        if (spacePosition) {
          custom[SPACE_RELATIVE_POSITION_CUSTOM_KEY] = JSON.stringify({
            x: position.x - spacePosition.x,
            y: position.y - spacePosition.y,
            z: position.z - spacePosition.z
          })
        }
      }

      return Object.keys(custom).length > 0 ? custom : undefined
    },
    [activeModelId, ensureIfcPlacementPosition, getElementWorldPosition, getIfcElementPlacementPosition]
  )

  return { buildFurnitureCustom }
}

// Injects the current inverse coordination matrix into persisted metadata and furniture entries when missing.
export const useIfcViewerInverseMatrixBackfill = ({
  activeModelId,
  activeModelInverseCoordinationMatrixRef,
  setFurnitureEntries,
  setMetadataEntries
}: UseIfcViewerInverseMatrixBackfillArgs) => {
  // This injects the active coordination matrix into saved custom objects that do not have it yet.
  useEffect(() => {
    const serializedMatrix = serializeInverseCoordinationMatrix(
      activeModelInverseCoordinationMatrixRef.current
    )
    if (!serializedMatrix) return
    setFurnitureEntries((prev) => injectMissingInverseCoordinationMatrix(prev, serializedMatrix))
  }, [activeModelId, setFurnitureEntries, activeModelInverseCoordinationMatrixRef])

  // This injects the active coordination matrix into saved metadata entries that do not have it yet.
  useEffect(() => {
    const serializedMatrix = serializeInverseCoordinationMatrix(
      activeModelInverseCoordinationMatrixRef.current
    )
    if (!serializedMatrix) return
    setMetadataEntries((prev) => injectMissingInverseCoordinationMatrix(prev, serializedMatrix))
  }, [activeModelId, setMetadataEntries, activeModelInverseCoordinationMatrixRef])
}
