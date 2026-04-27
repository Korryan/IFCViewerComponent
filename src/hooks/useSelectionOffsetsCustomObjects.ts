import { useCallback } from 'react'
import type { Dispatch, MutableRefObject, SetStateAction } from 'react'
import type { PropertyField, SelectedElement, Point3D, FurnitureGeometry, OffsetVector } from '../ifcViewerTypes'
import type { IfcViewerAPI } from '../viewer/IfcViewerAPICompat'
import {
  buildCustomPropertyFields as buildCustomPropertyFieldsFromRegistry,
  ensureCustomObjectsPickable,
  findCustomObjectExpressIdByItemId as findCustomObjectExpressIdByItemIdInRegistry,
  getCustomObjectState as getCustomObjectStateFromRegistry,
  removeCustomObject,
  setCustomObjectItemId as setCustomObjectItemIdInRegistry,
  setCustomObjectRoomNumber as setCustomObjectRoomNumberInRegistry,
  setCustomObjectSpaceIfcId as setCustomObjectSpaceIfcIdInRegistry,
  spawnCubeObject,
  spawnStoredCustomObject as spawnStoredCustomRegistryObject,
  spawnUploadedCustomObject,
  type CustomObjectRegistryRefs,
  type CustomObjectState,
  type SpawnedCubeInfo,
  type SpawnedModelInfo,
  type SpawnStoredCustomObjectArgs
} from './selectionOffsets.customRegistry'
import { CUSTOM_CUBE_MODEL_ID, pointToOffsetVector } from './selectionOffsets.shared'

type SetState<T> = Dispatch<SetStateAction<T>>

type SpawnCubeOptions = {
  focus?: boolean
  id?: number
}

type UseSelectionOffsetsCustomObjectsArgs = {
  viewerRef: { current: IfcViewerAPI | null }
  customObjectRegistryRefs: CustomObjectRegistryRefs
  cubeRegistryRef: MutableRefObject<Map<number, any>>
  clearIfcSelectionHighlight: (modelID?: number | null) => void
  focusOnPoint: (point: Point3D | null) => void
  removePickable: (viewer: IfcViewerAPI, mesh: any) => void
  setSelectedElement: SetState<SelectedElement | null>
  setOffsetInputs: SetState<OffsetVector>
  setPropertyFields: SetState<PropertyField[]>
  setPropertyError: SetState<string | null>
  setIsFetchingProperties: SetState<boolean>
  setCubeHighlight: (expressID: number | null) => void
}

type UseSelectionOffsetsCustomObjectsResult = {
  buildCustomPropertyFields: (expressID: number) => PropertyField[]
  setCustomCubeRoomNumber: (expressID: number, roomNumber?: string | null) => void
  setCustomObjectSpaceIfcId: (expressID: number, spaceIfcId?: number | null) => void
  setCustomObjectItemId: (expressID: number, itemId?: string | null) => void
  findCustomObjectExpressIdByItemId: (itemId: string | null | undefined) => number | null
  getCustomObjectState: (expressID: number) => CustomObjectState | null
  ensureCustomCubesPickable: () => void
  selectCustomCube: (expressID: number) => void
  removeCustomCube: (expressID: number) => void
  spawnCube: (target?: Point3D | null, options?: SpawnCubeOptions) => SpawnedCubeInfo | null
  spawnUploadedModel: (
    file: File,
    target?: Point3D | null,
    options?: { focus?: boolean }
  ) => Promise<SpawnedModelInfo | null>
  spawnStoredCustomObject: (args: {
    itemId: string
    model: string
    name?: string | null
    position: Point3D
    rotation?: Point3D | null
    geometry: FurnitureGeometry
    roomNumber?: string | null
    spaceIfcId?: number | null
    sourceFileName?: string | null
    focus?: boolean
  }) => { expressID: number; position: Point3D } | null
}

// Builds the custom-object callbacks used by the selection-offset hook.
export const useSelectionOffsetsCustomObjects = (
  args: UseSelectionOffsetsCustomObjectsArgs
): UseSelectionOffsetsCustomObjectsResult => {
  // This function builds the inspector fields shown when one custom object is selected.
  const buildCustomPropertyFields = useCallback(
    (expressID: number): PropertyField[] => {
      return buildCustomPropertyFieldsFromRegistry(args.customObjectRegistryRefs, expressID)
    },
    [args.customObjectRegistryRefs]
  )

  // This function stores the room number assigned to one custom object in the local registry.
  const setCustomCubeRoomNumber = useCallback((expressID: number, roomNumber?: string | null) => {
    setCustomObjectRoomNumberInRegistry(args.customObjectRegistryRefs, expressID, roomNumber)
  }, [args.customObjectRegistryRefs])

  // This function stores the IFC space id assigned to one custom object in the local registry.
  const setCustomObjectSpaceIfcId = useCallback((expressID: number, spaceIfcId?: number | null) => {
    setCustomObjectSpaceIfcIdInRegistry(args.customObjectRegistryRefs, expressID, spaceIfcId)
  }, [args.customObjectRegistryRefs])

  // This function stores the persisted item id assigned to one custom object in the local registry.
  const setCustomObjectItemId = useCallback((expressID: number, itemId?: string | null) => {
    setCustomObjectItemIdInRegistry(args.customObjectRegistryRefs, expressID, itemId)
  }, [args.customObjectRegistryRefs])

  // This function resolves a custom object express id from the persisted item id stored in the registry.
  const findCustomObjectExpressIdByItemId = useCallback((itemId: string | null | undefined): number | null => {
    return findCustomObjectExpressIdByItemIdInRegistry(args.customObjectRegistryRefs, itemId)
  }, [args.customObjectRegistryRefs])

  // This function returns the full custom object state tracked in the local registry for one express id.
  const getCustomObjectState = useCallback((expressID: number): CustomObjectState | null => {
    return getCustomObjectStateFromRegistry(args.customObjectRegistryRefs, expressID)
  }, [args.customObjectRegistryRefs])

  // This function re-registers every custom object as pickable after viewer state changes.
  const ensureCustomCubesPickable = useCallback(() => {
    const viewer = args.viewerRef.current
    if (!viewer) return
    ensureCustomObjectsPickable(viewer, args.customObjectRegistryRefs)
  }, [args.customObjectRegistryRefs, args.viewerRef])

  // This function selects one custom object, populates the inspector state, and clears IFC highlight state.
  const selectCustomCube = useCallback(
    (expressID: number) => {
      const customObject = args.cubeRegistryRef.current.get(expressID)
      if (!customObject) return
      args.clearIfcSelectionHighlight()
      args.viewerRef.current?.IFC.selector.unpickIfcItems()
      const pos = customObject.position
      const customState = getCustomObjectState(expressID)
      args.setSelectedElement({
        modelID: CUSTOM_CUBE_MODEL_ID,
        expressID,
        type: customState?.model?.toUpperCase() ?? 'CUSTOM'
      })
      args.setOffsetInputs(pointToOffsetVector(pos))
      args.setPropertyFields(buildCustomPropertyFields(expressID))
      args.setPropertyError(null)
      args.setIsFetchingProperties(false)
      args.setCubeHighlight(expressID)
    },
    [
      args.clearIfcSelectionHighlight,
      args.cubeRegistryRef,
      args.setCubeHighlight,
      args.setIsFetchingProperties,
      args.setOffsetInputs,
      args.setPropertyError,
      args.setPropertyFields,
      args.setSelectedElement,
      args.viewerRef,
      buildCustomPropertyFields,
      getCustomObjectState
    ]
  )

  // This function removes one custom object from the scene and from the local registry.
  const removeCustomCube = useCallback(
    (expressID: number) => {
      const viewer = args.viewerRef.current
      if (!viewer) return
      removeCustomObject(viewer, args.customObjectRegistryRefs, expressID, args.removePickable)
    },
    [args.customObjectRegistryRefs, args.removePickable, args.viewerRef]
  )

  // This function spawns one custom cube and optionally focuses the camera on its resolved position.
  const spawnCube = useCallback(
    (target?: Point3D | null, options?: SpawnCubeOptions): SpawnedCubeInfo | null => {
      const viewer = args.viewerRef.current
      if (!viewer) return null
      const spawned = spawnCubeObject(viewer, args.customObjectRegistryRefs, target, options?.id)
      if (options?.focus && spawned) {
        args.focusOnPoint(spawned.position)
      }
      return spawned
    },
    [args.customObjectRegistryRefs, args.focusOnPoint, args.viewerRef]
  )

  // This function loads an uploaded prefab model, registers it as a custom object, and optionally focuses it.
  const spawnUploadedModel = useCallback(
    async (
      file: File,
      target?: Point3D | null,
      options?: { focus?: boolean }
    ): Promise<SpawnedModelInfo | null> => {
      const viewer = args.viewerRef.current
      if (!viewer) return null
      try {
        const spawned = await spawnUploadedCustomObject(
          viewer,
          args.customObjectRegistryRefs,
          file,
          target
        )
        if (options?.focus && spawned) {
          args.focusOnPoint(spawned.position)
        }
        return spawned
      } catch (err) {
        console.error('Failed to load uploaded model', err)
      }
      return null
    },
    [args.customObjectRegistryRefs, args.focusOnPoint, args.viewerRef]
  )

  // This function restores one persisted custom object into the scene and optionally focuses it.
  const spawnStoredCustomObject = useCallback(
    (storedArgs: SpawnStoredCustomObjectArgs): { expressID: number; position: Point3D } | null => {
      const viewer = args.viewerRef.current
      if (!viewer) return null

      const restored = spawnStoredCustomRegistryObject(
        viewer,
        args.customObjectRegistryRefs,
        storedArgs
      )
      if (storedArgs.focus && restored) {
        args.focusOnPoint(restored.position)
      }
      return restored
    },
    [args.customObjectRegistryRefs, args.focusOnPoint, args.viewerRef]
  )

  return {
    buildCustomPropertyFields,
    setCustomCubeRoomNumber,
    setCustomObjectSpaceIfcId,
    setCustomObjectItemId,
    findCustomObjectExpressIdByItemId,
    getCustomObjectState,
    ensureCustomCubesPickable,
    selectCustomCube,
    removeCustomCube,
    spawnCube,
    spawnUploadedModel,
    spawnStoredCustomObject
  }
}
