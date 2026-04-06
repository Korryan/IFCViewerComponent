import { useCallback, useMemo, useRef, useState } from 'react'
// Encapsulates selection, IFC property fetching, and offset/subset handling
import { Matrix4, Mesh, MeshStandardMaterial, Vector3 } from 'three'
import type { IfcViewerAPI } from '../viewer/IfcViewerAPICompat'
import type {
  FurnitureGeometry,
  OffsetVector,
  Point3D,
  PropertyField,
  SelectedElement
} from '../ifcViewerTypes'
import {
  CUSTOM_CUBE_MODEL_ID,
  normalizeCoordinateValue,
  pointToOffsetVector,
  zeroOffset
} from './selectionOffsets.shared'
import {
  getMovedIdsForModel as getMovedIdsForModelFromSubsets,
  removeMovedSubset
} from './selectionOffsets.subsets'
import {
  clearOffsetArtifacts as clearOffsetArtifactsInternal,
  configureSpaceBiasTargets as configureSpaceBiasTargetsInternal,
  ensureBaseSubset as ensureBaseSubsetInternal,
  updateSpaceBiasSubset as updateSpaceBiasSubsetInternal,
  updateVisibilityForModel as updateVisibilityForModelInternal
} from './selectionOffsets.subsetState'
import {
  ensureIfcPlacementPosition as ensureIfcPlacementPositionInternal,
  getBaseCenter as getBaseCenterInternal,
  getElementWorldPosition as getElementWorldPositionInternal,
  getIfcElementBasePosition as getIfcElementBasePositionInternal,
  getIfcElementPlacementPosition as getIfcElementPlacementPositionInternal,
  getIfcElementRotationDelta as getIfcElementRotationDeltaInternal,
  getIfcElementTranslationDelta as getIfcElementTranslationDeltaInternal,
  getModelBaseOffset as getModelBaseOffsetInternal,
  primeIfcPlacementOrigin as primeIfcPlacementOriginInternal
} from './selectionOffsets.placement'
import {
  buildPropertyFields as buildIfcPropertyFields
} from './selectionOffsets.properties'
import {
  getExpressIdFromHit as getExpressIdFromPickHit,
  pickCandidatesAtPoint,
  type PickCandidate
} from './selectionOffsets.picking'
import {
  fetchSelectionProperties,
  handleSelectionPick,
  selectIfcElementById
} from './selectionOffsets.selection'
import {
  focusViewerOnPoint,
  getSelectedElementWorldPosition,
  resetSelectionState,
  setHighlightedCustomObject
} from './selectionOffsets.ui'
import {
  applyIfcSelectionHighlight as applyIfcSelectionHighlightInternal,
  clearIfcSelectionHighlightState as clearIfcSelectionHighlightInternal,
  highlightIfcGroup as highlightIfcGroupInternal
} from './selectionOffsets.highlight'
import {
  applyIfcElementTransform as applyIfcElementTransformInternal,
  moveSelectedElement,
  rotateSelectedElement
} from './selectionOffsets.transforms'
import {
  buildCustomPropertyFields as buildCustomPropertyFieldsFromRegistry,
  findCustomObjectExpressIdByItemId as findCustomObjectExpressIdByItemIdInRegistry,
  getCustomObjectState as getCustomObjectStateFromRegistry,
  removeCustomObject,
  setCustomObjectItemId as setCustomObjectItemIdInRegistry,
  setCustomObjectRoomNumber as setCustomObjectRoomNumberInRegistry,
  setCustomObjectSpaceIfcId as setCustomObjectSpaceIfcIdInRegistry,
  spawnCubeObject,
  spawnStoredCustomObject as spawnStoredCustomRegistryObject,
  spawnUploadedCustomObject,
  ensureCustomObjectsPickable,
  type CustomObjectRegistryRefs,
  type CustomObjectState,
  type SpawnedCubeInfo,
  type SpawnedModelInfo,
  type SpawnStoredCustomObjectArgs
} from './selectionOffsets.customRegistry'

export { CUSTOM_CUBE_MODEL_ID } from './selectionOffsets.shared'
export type { PickCandidate } from './selectionOffsets.picking'

const tuneSpaceBiasSubsetMesh = (_mesh: Mesh | null | undefined) => {}

type SpawnCubeOptions = {
  focus?: boolean
  id?: number
}

type SelectionTypeFilterOptions = {
  allowedIfcTypes?: string[]
}

type UseSelectionOffsetsResult = {
  selectedElement: SelectedElement | null
  offsetInputs: OffsetVector
  propertyFields: PropertyField[]
  propertyError: string | null
  isFetchingProperties: boolean
  handleOffsetInputChange: (axis: keyof OffsetVector, value: number) => void
  applyOffsetToSelectedElement: () => void
  handleFieldChange: (key: string, value: string) => void
  handlePick: (options?: { autoFocus?: boolean; allowedIfcTypes?: string[] }) => Promise<void>
  selectById: (
    modelID: number,
    expressID: number,
    options?: { autoFocus?: boolean; allowedIfcTypes?: string[] }
  ) => Promise<Point3D | null>
  selectCustomCube: (expressID: number) => void
  clearIfcHighlight: () => void
  highlightIfcGroup: (
    modelID: number,
    expressIDs: number[],
    options?: { anchorExpressID?: number | null }
  ) => void
  hasRenderableExpressId: (modelID: number, expressID: number) => boolean
  getIfcElementBasePosition: (modelID: number, expressID: number) => Point3D | null
  getIfcElementPlacementPosition: (modelID: number, expressID: number) => Point3D | null
  ensureIfcPlacementPosition: (modelID: number, expressID: number) => Promise<Point3D | null>
  getIfcElementTranslationDelta: (modelID: number, expressID: number) => Point3D | null
  getIfcElementRotationDelta: (modelID: number, expressID: number) => Point3D | null
  getElementWorldPosition: (modelID: number, expressID: number) => Point3D | null
  moveSelectedTo: (targetOffset: OffsetVector) => void
  applyIfcElementOffset: (modelID: number, expressID: number, targetOffset: OffsetVector) => void
  applyIfcElementRotation: (modelID: number, expressID: number, targetRotation: Point3D) => void
  rotateSelectedTo: (targetRotation: Point3D) => void
  hideIfcElement: (modelID: number, expressID: number) => void
  setCustomCubeRoomNumber: (expressID: number, roomNumber?: string | null) => void
  setCustomObjectSpaceIfcId: (expressID: number, spaceIfcId?: number | null) => void
  setCustomObjectItemId: (expressID: number, itemId?: string | null) => void
  findCustomObjectExpressIdByItemId: (itemId: string | null | undefined) => number | null
  getCustomObjectState: (expressID: number) => CustomObjectState | null
  ensureCustomCubesPickable: () => void
  pickCandidatesAt: (
    clientX: number,
    clientY: number,
    container: HTMLElement,
    maxDistance?: number
  ) => PickCandidate[]
  getSelectedWorldPosition: () => Vector3 | null
  resetSelection: () => void
  clearOffsetArtifacts: (modelID?: number | null) => void
  spawnCube: (target?: Point3D | null, options?: SpawnCubeOptions) => SpawnedCubeInfo | null
  removeCustomCube: (expressID: number) => void
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
  applyVisibilityFilter: (modelID: number, visibleIds: number[] | null) => void
  configureSpaceBiasTargets: (modelID: number, expressIDs: number[]) => void
}

export const useSelectionOffsets = (
  viewerRef: { current: IfcViewerAPI | null }
): UseSelectionOffsetsResult => {
  // Local caches for subsets/cubes/offsets; kept outside React state to avoid re-renders
  const propertyRequestRef = useRef(0)
  const baseSubsetsRef = useRef<Map<number, Mesh>>(new Map())
  const movedSubsetsRef = useRef<Map<string, Mesh>>(new Map())
  const spaceBiasSubsetsRef = useRef<Map<number, Mesh>>(new Map())
  const spaceBiasIdsRef = useRef<Map<number, Set<number>>>(new Map())
  const spaceBiasAppliedRef = useRef<Map<number, Set<number>>>(new Map())
  const hiddenIdsRef = useRef<Map<number, Set<number>>>(new Map())
  const elementOffsetsRef = useRef<Map<string, OffsetVector>>(new Map())
  const elementRotationsRef = useRef<Map<string, Point3D>>(new Map())
  const expressIdCacheRef = useRef<Map<number, Set<number>>>(new Map())
  const baseCentersRef = useRef<Map<string, Point3D>>(new Map())
  const placementOriginsRef = useRef<Map<string, Point3D>>(new Map())
  const coordinationMatrixRef = useRef<Map<number, Matrix4 | null>>(new Map())
  const filterSubsetsRef = useRef<Map<number, Mesh>>(new Map())
  const filterIdsRef = useRef<Map<number, Set<number> | null>>(new Map())
  const cubeRegistryRef = useRef<Map<number, Mesh>>(new Map())
  const cubeIdCounterRef = useRef(1)
  const highlightedCubeRef = useRef<number | null>(null)
  const highlightedIfcRef = useRef<{ modelID: number; expressID: number } | null>(null)
  const selectionSubsetsRef = useRef<Map<number, Mesh>>(new Map())
  const selectionMaterialRef = useRef<MeshStandardMaterial | null>(null)
  const focusOffsetRef = useRef<Point3D | null>(null)
  const customCubeRoomsRef = useRef<Map<number, string>>(new Map())
  const customObjectSpaceIfcIdsRef = useRef<Map<number, number>>(new Map())
  const customObjectModelsRef = useRef<Map<number, string>>(new Map())
  const customObjectNamesRef = useRef<Map<number, string>>(new Map())
  const customObjectItemIdsRef = useRef<Map<number, string>>(new Map())
  const customObjectSourceFilesRef = useRef<Map<number, string>>(new Map())
  const customObjectRegistryRefs = useMemo<CustomObjectRegistryRefs>(
    () => ({
      cubeRegistryRef,
      cubeIdCounterRef,
      highlightedCubeRef,
      customCubeRoomsRef,
      customObjectSpaceIfcIdsRef,
      customObjectModelsRef,
      customObjectNamesRef,
      customObjectItemIdsRef,
      customObjectSourceFilesRef
    }),
    []
  )

  const [selectedElement, setSelectedElement] = useState<SelectedElement | null>(null)
  const [offsetInputs, setOffsetInputs] = useState<OffsetVector>(zeroOffset)
  const [propertyFields, setPropertyFields] = useState<PropertyField[]>([])
  const [propertyError, setPropertyError] = useState<string | null>(null)
  const [isFetchingProperties, setIsFetchingProperties] = useState(false)
  const normalizeIfcTypeName = useCallback((value: unknown): string | null => {
    if (typeof value !== 'string') return null
    const trimmed = value.trim()
    return trimmed ? trimmed.toUpperCase() : null
  }, [])

  const resolveIfcTypeName = useCallback(
    async (viewer: IfcViewerAPI, modelID: number, expressID: number): Promise<string | null> => {
      try {
        const manager = viewer.IFC?.loader?.ifcManager as
          | { getIfcType?: (idModel: number, idExpress: number) => string | undefined }
          | undefined
        const directType = manager?.getIfcType?.(modelID, expressID)
        if (directType) {
          return normalizeIfcTypeName(directType)
        }

        const props = await viewer.IFC.getProperties(modelID, expressID, false, false)
        return normalizeIfcTypeName(
          typeof props?.ifcClass === 'string'
            ? props.ifcClass
            : typeof props?.type === 'string'
              ? props.type
              : null
        )
      } catch (err) {
        console.warn('Failed to resolve IFC type for selection filter', expressID, err)
        return null
      }
    },
    [normalizeIfcTypeName]
  )

  const isIfcSelectionAllowed = useCallback(
    async (
      viewer: IfcViewerAPI,
      modelID: number,
      expressID: number,
      options?: SelectionTypeFilterOptions
    ): Promise<boolean> => {
      const allowedIfcTypes = options?.allowedIfcTypes
      if (!allowedIfcTypes || allowedIfcTypes.length === 0) {
        return true
      }
      const normalizedAllowed = new Set(
        allowedIfcTypes
          .map((typeName) => normalizeIfcTypeName(typeName))
          .filter((typeName): typeName is string => Boolean(typeName))
      )
      if (normalizedAllowed.size === 0) {
        return true
      }
      const resolvedType = await resolveIfcTypeName(viewer, modelID, expressID)
      return Boolean(resolvedType && normalizedAllowed.has(resolvedType))
    },
    [normalizeIfcTypeName, resolveIfcTypeName]
  )

  const clearIfcSelectionHighlight = useCallback(
    (modelID?: number | null) => {
      clearIfcSelectionHighlightInternal({
        viewer: viewerRef.current,
        modelID,
        selectionSubsetsRef,
        highlightedIfcRef
      })
    },
    [viewerRef]
  )

  const focusOnPoint = useCallback((point: Point3D | null) => {
    focusViewerOnPoint(viewerRef.current, point)
  }, [viewerRef])

  const setCubeHighlight = useCallback((expressID: number | null) => {
    setHighlightedCustomObject(customObjectRegistryRefs, expressID)
  }, [customObjectRegistryRefs])

  const getSelectedWorldPosition = useCallback((): Vector3 | null => {
    return getSelectedElementWorldPosition({
      selectedElement,
      offsetInputs,
      cubeRegistryRef
    })
  }, [offsetInputs, selectedElement])

  const resetSelection = useCallback(() => {
    resetSelectionState({
      propertyRequestRef,
      setSelectedElement,
      setOffsetInputs,
      setPropertyFields,
      setPropertyError,
      setIsFetchingProperties,
      focusOffsetRef,
      customObjectRegistryRefs,
      clearIfcSelectionHighlight,
      viewer: viewerRef.current
    })
  }, [clearIfcSelectionHighlight, customObjectRegistryRefs, viewerRef])

  const getElementKey = useCallback((modelID: number, expressID: number) => {
    return `${modelID}:${expressID}`
  }, [])

  const primeIfcPlacementOrigin = useCallback(
    async (modelID: number, expressID: number, properties?: any): Promise<Point3D | null> => {
      const viewer = viewerRef.current
      if (!viewer) return null
      return await primeIfcPlacementOriginInternal({
        viewer,
        modelID,
        expressID,
        properties,
        placementOriginsRef,
        coordinationMatrixRef,
        getElementKey
      })
    },
    [getElementKey, viewerRef]
  )

  const getModelBaseOffset = useCallback(
    (modelID: number): OffsetVector => {
      return getModelBaseOffsetInternal({
        viewer: viewerRef.current,
        modelID,
        baseSubsetsRef
      })
    },
    [viewerRef]
  )

  const removePickable = useCallback((viewer: IfcViewerAPI, mesh: Mesh) => {
    const pickables = viewer.context.items.pickableIfcModels
    const index = pickables.indexOf(mesh as any)
    if (index !== -1) {
      pickables.splice(index, 1)
    }
  }, [])

  const registerPickable = useCallback(
    (viewer: IfcViewerAPI, mesh: Mesh, slot?: number) => {
      const pickables = viewer.context.items.pickableIfcModels
      if (typeof slot === 'number') {
        pickables[slot] = mesh as any
        return
      }
      if (!pickables.includes(mesh as any)) {
        pickables.push(mesh as any)
      }
    },
    []
  )

  const getExpressIdSet = useCallback(
    (modelID: number) => {
      const cached = expressIdCacheRef.current.get(modelID)
      if (cached && cached.size > 0) return cached

      const viewer = viewerRef.current
      const model = viewer?.IFC.loader.ifcManager.state?.models?.[modelID]?.mesh as Mesh | undefined
      const expressAttr = model?.geometry.getAttribute('expressID')
      if (!expressAttr || !('array' in expressAttr)) {
        // Model/geometry might not be ready yet. Do not cache empty permanently.
        return cached ?? new Set<number>()
      }

      const uniqueIds = new Set<number>()
      Array.from((expressAttr as { array: ArrayLike<number> }).array).forEach((rawId) => {
        if (typeof rawId === 'number') {
          uniqueIds.add(Math.trunc(rawId))
        }
      })

      if (uniqueIds.size > 0) {
        expressIdCacheRef.current.set(modelID, uniqueIds)
      } else if (!cached) {
        expressIdCacheRef.current.set(modelID, uniqueIds)
      }
      return uniqueIds
    },
    [viewerRef]
  )

  const getAllExpressIdsForModel = useCallback(
    (modelID: number) => {
      // Extract every expressID present in a model geometry
      const ids = getExpressIdSet(modelID)
      return ids.size > 0 ? Array.from(ids) : []
    },
    [getExpressIdSet]
  )

  const hasRenderableExpressId = useCallback(
    (modelID: number, expressID: number) => {
      return getExpressIdSet(modelID).has(expressID)
    },
    [getExpressIdSet]
  )

  const applyIfcSelectionHighlight = useCallback(
    (modelID: number, expressID: number) => {
      applyIfcSelectionHighlightInternal({
        viewer: viewerRef.current,
        modelID,
        expressID,
        selectionSubsetsRef,
        highlightedIfcRef,
        selectionMaterialRef,
        movedSubsetsRef,
        baseSubsetsRef,
        getElementKey,
        hasRenderableExpressId
      })
    },
    [getElementKey, hasRenderableExpressId, viewerRef]
  )

  const highlightIfcGroup = useCallback(
    (modelID: number, expressIDs: number[], options?: { anchorExpressID?: number | null }) => {
      highlightIfcGroupInternal({
        viewer: viewerRef.current,
        modelID,
        expressIDs,
        anchorExpressID: options?.anchorExpressID ?? null,
        selectionSubsetsRef,
        highlightedIfcRef,
        selectionMaterialRef,
        movedSubsetsRef,
        baseSubsetsRef,
        getElementKey,
        hasRenderableExpressId
      })
    },
    [getElementKey, hasRenderableExpressId, viewerRef]
  )

  const getBaseCenter = useCallback(
    (modelID: number, expressID: number): Point3D | null => {
      const viewer = viewerRef.current
      if (!viewer) return null
      return getBaseCenterInternal({
        viewer,
        modelID,
        expressID,
        baseCentersRef,
        getElementKey,
        hasRenderableExpressId
      })
    },
    [getElementKey, hasRenderableExpressId, viewerRef]
  )

  const getElementWorldPosition = useCallback(
    (modelID: number, expressID: number): Point3D | null => {
      return getElementWorldPositionInternal({
        modelID,
        expressID,
        cubeRegistryRef,
        elementOffsetsRef,
        getElementKey,
        getBaseCenter
      })
    },
    [getBaseCenter, getElementKey]
  )

  const getIfcElementBasePosition = useCallback(
    (modelID: number, expressID: number): Point3D | null => {
      return getIfcElementBasePositionInternal({
        modelID,
        expressID,
        cubeRegistryRef,
        getBaseCenter
      })
    },
    [getBaseCenter]
  )

  const getIfcElementPlacementPosition = useCallback(
    (modelID: number, expressID: number): Point3D | null => {
      return getIfcElementPlacementPositionInternal({
        viewer: viewerRef.current,
        modelID,
        expressID,
        placementOriginsRef,
        movedSubsetsRef,
        baseSubsetsRef,
        elementOffsetsRef,
        getElementKey,
        getBaseCenter
      })
    },
    [getBaseCenter, getElementKey, viewerRef]
  )

  const ensureIfcPlacementPosition = useCallback(
    async (modelID: number, expressID: number): Promise<Point3D | null> => {
      const viewer = viewerRef.current
      if (!viewer) return null
      return await ensureIfcPlacementPositionInternal({
        viewer,
        modelID,
        expressID,
        getIfcElementPlacementPosition,
        primeIfcPlacementOrigin
      })
    },
    [getIfcElementPlacementPosition, primeIfcPlacementOrigin, viewerRef]
  )

  const getIfcElementTranslationDelta = useCallback(
    (modelID: number, expressID: number): Point3D | null => {
      return getIfcElementTranslationDeltaInternal({
        modelID,
        expressID,
        placementOriginsRef,
        elementOffsetsRef,
        getElementKey,
        getIfcElementPlacementPosition,
        getBaseCenter
      })
    },
    [getBaseCenter, getElementKey, getIfcElementPlacementPosition]
  )

  const getIfcElementRotationDelta = useCallback(
    (modelID: number, expressID: number): Point3D | null => {
      return getIfcElementRotationDeltaInternal({
        modelID,
        expressID,
        cubeRegistryRef,
        elementRotationsRef,
        getElementKey
      })
    },
    [getElementKey]
  )

  const ensureBaseSubset = useCallback(
    (modelID: number) => {
      const viewer = viewerRef.current
      if (!viewer) return null
      return ensureBaseSubsetInternal({
        viewer,
        modelID,
        baseSubsetsRef,
        getAllExpressIdsForModel,
        registerPickable
      })
    },
    [getAllExpressIdsForModel, registerPickable, viewerRef]
  )

  const getMovedIdsForModel = useCallback((modelID: number) => {
    return getMovedIdsForModelFromSubsets(movedSubsetsRef.current, modelID)
  }, [])

  const updateSpaceBiasSubset = useCallback(
    (modelID: number, allowedIds: Set<number> | null) => {
      const viewer = viewerRef.current
      if (!viewer) return
      updateSpaceBiasSubsetInternal({
        viewer,
        modelID,
        allowedIds,
        baseSubsetsRef,
        spaceBiasSubsetsRef,
        spaceBiasIdsRef,
        getMovedIdsForModel,
        registerPickable,
        removePickable,
        tuneSpaceBiasSubsetMesh
      })
    },
    [getMovedIdsForModel, registerPickable, removePickable, viewerRef]
  )

  const configureSpaceBiasTargets = useCallback(
    (modelID: number, _expressIDs: number[]) => {
      const viewer = viewerRef.current
      if (!viewer) return
      configureSpaceBiasTargetsInternal({
        viewer,
        modelID,
        baseSubsetsRef,
        spaceBiasAppliedRef,
        spaceBiasIdsRef,
        filterIdsRef,
        ensureBaseSubset,
        updateSpaceBiasSubset
      })
    },
    [ensureBaseSubset, updateSpaceBiasSubset, viewerRef]
  )

  const clearOffsetArtifacts = useCallback(
    (modelID?: number | null) => {
      const viewer = viewerRef.current
      if (!viewer) return
      clearOffsetArtifactsInternal({
        viewer,
        modelID,
        baseSubsetsRef,
        spaceBiasSubsetsRef,
        selectionSubsetsRef,
        movedSubsetsRef,
        filterSubsetsRef,
        filterIdsRef,
        elementOffsetsRef,
        elementRotationsRef,
        hiddenIdsRef,
        expressIdCacheRef,
        baseCentersRef,
        placementOriginsRef,
        coordinationMatrixRef,
        highlightedIfcRef,
        spaceBiasIdsRef,
        spaceBiasAppliedRef,
        registerPickable,
        removePickable,
        customObjectRegistryRefs
      })
    },
    [
      customObjectRegistryRefs,
      registerPickable,
      removePickable,
      viewerRef
    ]
  )

  const updateVisibilityForModel = useCallback(
    (modelID: number, allowedIds: Set<number> | null) => {
      const viewer = viewerRef.current
      if (!viewer) return
      updateVisibilityForModelInternal({
        viewer,
        modelID,
        allowedIds,
        filterIdsRef,
        hiddenIdsRef,
        filterSubsetsRef,
        movedSubsetsRef,
        baseSubsetsRef,
        ensureBaseSubset,
        getMovedIdsForModel,
        getAllExpressIdsForModel,
        updateSpaceBiasSubset,
        registerPickable,
        removePickable
      })
    },
    [
      ensureBaseSubset,
      getAllExpressIdsForModel,
      getMovedIdsForModel,
      registerPickable,
      removePickable,
      updateSpaceBiasSubset,
      viewerRef
    ]
  )

  const applyVisibilityFilter = useCallback(
    (modelID: number, visibleIds: number[] | null) => {
      const allowed =
        visibleIds === null ? null : new Set(visibleIds.filter(Number.isFinite))
      filterIdsRef.current.set(modelID, allowed)
      updateVisibilityForModel(modelID, allowed)
    },
    [updateVisibilityForModel]
  )

  const buildPropertyFields = useCallback(
    (rawProperties: any): PropertyField[] => {
      return buildIfcPropertyFields(rawProperties)
    },
    []
  )

  const fetchProperties = useCallback(
    async (modelID: number, expressID: number, focusPoint?: Point3D | null) => {
      const viewer = viewerRef.current
      if (!viewer) return
      await fetchSelectionProperties({
        viewer,
        modelID,
        expressID,
        focusPoint,
        propertyRequestRef,
        focusOffsetRef,
        elementOffsetsRef,
        buildPropertyFields,
        getElementKey,
        getElementWorldPosition,
        getModelBaseOffset,
        getBaseCenter,
        primeIfcPlacementOrigin,
        setSelectedElement,
        setOffsetInputs,
        setPropertyFields,
        setPropertyError,
        setIsFetchingProperties
      })
    },
    [
      buildPropertyFields,
      getBaseCenter,
      getElementKey,
      getElementWorldPosition,
      getModelBaseOffset,
      primeIfcPlacementOrigin,
      viewerRef
    ]
  )

  const handleFieldChange = useCallback((key: string, value: string) => {
    setPropertyFields((prev) => prev.map((field) => (field.key === key ? { ...field, value } : field)))
  }, [])

  const handleOffsetInputChange = useCallback((axis: keyof OffsetVector, value: number) => {
    setOffsetInputs((prev) => ({
      ...prev,
      [axis]: normalizeCoordinateValue(value)
    }))
  }, [])

  const setCustomCubeRoomNumber = useCallback((expressID: number, roomNumber?: string | null) => {
    setCustomObjectRoomNumberInRegistry(customObjectRegistryRefs, expressID, roomNumber)
  }, [customObjectRegistryRefs])

  const setCustomObjectSpaceIfcId = useCallback((expressID: number, spaceIfcId?: number | null) => {
    setCustomObjectSpaceIfcIdInRegistry(customObjectRegistryRefs, expressID, spaceIfcId)
  }, [customObjectRegistryRefs])

  const setCustomObjectItemId = useCallback((expressID: number, itemId?: string | null) => {
    setCustomObjectItemIdInRegistry(customObjectRegistryRefs, expressID, itemId)
  }, [customObjectRegistryRefs])

  const findCustomObjectExpressIdByItemId = useCallback((itemId: string | null | undefined): number | null => {
    return findCustomObjectExpressIdByItemIdInRegistry(customObjectRegistryRefs, itemId)
  }, [customObjectRegistryRefs])

  const getCustomObjectState = useCallback((expressID: number): CustomObjectState | null => {
    return getCustomObjectStateFromRegistry(customObjectRegistryRefs, expressID)
  }, [customObjectRegistryRefs])

  const ensureCustomCubesPickable = useCallback(() => {
    const viewer = viewerRef.current
    if (!viewer) return
    ensureCustomObjectsPickable(viewer, customObjectRegistryRefs)
  }, [customObjectRegistryRefs, viewerRef])

  const buildCustomPropertyFields = useCallback(
    (expressID: number): PropertyField[] => {
      return buildCustomPropertyFieldsFromRegistry(customObjectRegistryRefs, expressID)
    },
    [customObjectRegistryRefs]
  )

  const getExpressIdFromHit = useCallback((hit: {
    object: Mesh
    face?: { a?: number }
    faceIndex?: number
  }): number | null => {
    return getExpressIdFromPickHit(hit)
  }, [])

  const pickCandidatesAt = useCallback(
    (
      clientX: number,
      clientY: number,
      container: HTMLElement,
      maxDistance = 0.02
    ): PickCandidate[] => {
      const viewer = viewerRef.current
      if (!viewer) return []
      return pickCandidatesAtPoint(
        viewer,
        Array.from(cubeRegistryRef.current.values()),
        clientX,
        clientY,
        container,
        maxDistance
      )
    },
    [viewerRef]
  )

  const applyIfcElementTransform = useCallback(
    (
      modelID: number,
      expressID: number,
      targetOffset: OffsetVector,
      targetRotation?: Point3D | null
    ) => {
      const viewer = viewerRef.current
      if (!viewer) return
      applyIfcElementTransformInternal({
        viewer,
        modelID,
        expressID,
        targetOffset,
        targetRotation,
        ensureBaseSubset,
        getBaseCenter,
        getElementKey,
        hasRenderableExpressId,
        elementOffsetsRef,
        elementRotationsRef,
        movedSubsetsRef,
        filterIdsRef,
        highlightedIfcRef,
        registerPickable,
        removePickable,
        updateVisibilityForModel,
        applyIfcSelectionHighlight
      })
    },
    [
      applyIfcSelectionHighlight,
      ensureBaseSubset,
      getBaseCenter,
      getElementKey,
      hasRenderableExpressId,
      registerPickable,
      removePickable,
      updateVisibilityForModel,
      viewerRef
    ]
  )

  const applyIfcElementOffset = useCallback(
    (modelID: number, expressID: number, targetOffset: OffsetVector) => {
      const key = getElementKey(modelID, expressID)
      applyIfcElementTransform(modelID, expressID, targetOffset, elementRotationsRef.current.get(key))
    },
    [applyIfcElementTransform, getElementKey]
  )

  const applyIfcElementRotation = useCallback(
    (modelID: number, expressID: number, targetRotation: Point3D) => {
      const center = getElementWorldPosition(modelID, expressID) ?? getBaseCenter(modelID, expressID)
      if (!center) return
      applyIfcElementTransform(
        modelID,
        expressID,
        { dx: center.x, dy: center.y, dz: center.z },
        targetRotation
      )
    },
    [applyIfcElementTransform, getBaseCenter, getElementWorldPosition]
  )

  const moveSelectedTo = useCallback(
    (targetOffset: OffsetVector) => {
      const viewer = viewerRef.current
      if (!viewer || !selectedElement) return
      moveSelectedElement({
        viewer,
        selectedElement,
        targetOffset,
        setOffsetInputs,
        focusOffsetRef,
        cubeRegistryRef,
        elementOffsetsRef,
        applyIfcElementOffset
      })
    },
    [
      applyIfcElementOffset,
      selectedElement,
      setOffsetInputs,
      viewerRef
    ]
  )

  const applyOffsetToSelectedElement = useCallback(() => {
    moveSelectedTo(offsetInputs)
  }, [moveSelectedTo, offsetInputs])

  const handlePick = useCallback(async (options?: { autoFocus?: boolean; allowedIfcTypes?: string[] }) => {
    const viewer = viewerRef.current
    if (!viewer) {
      return
    }

    try {
      await handleSelectionPick({
        viewer,
        options,
        cubeRegistryRef,
        cubeIdCounterRef,
        elementOffsetsRef,
        buildCustomPropertyFields,
        fetchProperties,
        applyIfcSelectionHighlight,
        clearIfcSelectionHighlight,
        getCustomObjectState,
        getElementWorldPosition,
        getExpressIdFromHit,
        isIfcSelectionAllowed,
        resetSelection,
        setCubeHighlight,
        focusOnPoint,
        setSelectedElement,
        setOffsetInputs,
        setPropertyFields,
        setPropertyError,
        setIsFetchingProperties
      })
    } catch (err) {
      console.error('Failed to pick IFC item', err)
      resetSelection()
    }
  }, [
    buildCustomPropertyFields,
    fetchProperties,
    applyIfcSelectionHighlight,
    clearIfcSelectionHighlight,
    focusOnPoint,
    getCustomObjectState,
    getElementWorldPosition,
    getExpressIdFromHit,
    isIfcSelectionAllowed,
    resetSelection,
    setCubeHighlight,
    viewerRef
  ])

  const selectById = useCallback(
    async (
      modelID: number,
      expressID: number,
      options?: { autoFocus?: boolean; allowedIfcTypes?: string[] }
    ) => {
      const viewer = viewerRef.current
      if (!viewer) return null
      try {
        return await selectIfcElementById({
          viewer,
          modelID,
          expressID,
          options,
          elementOffsetsRef,
          fetchProperties,
          getElementKey,
          focusOnPoint,
          getElementWorldPosition,
          getModelBaseOffset,
          getBaseCenter,
          hasRenderableExpressId,
          isIfcSelectionAllowed,
          resetSelection,
          applyIfcSelectionHighlight,
          clearIfcSelectionHighlight,
          setSelectedElement,
          setOffsetInputs,
          setPropertyFields,
          setPropertyError,
          setIsFetchingProperties
        })
      } catch (err) {
        console.error('Failed to select IFC item by id', err)
      }
      return null
    },
    [
      applyIfcSelectionHighlight,
      clearIfcSelectionHighlight,
      fetchProperties,
      getElementKey,
      focusOnPoint,
      getElementWorldPosition,
      getModelBaseOffset,
      hasRenderableExpressId,
      isIfcSelectionAllowed,
      resetSelection,
      viewerRef
    ]
  )

  const rotateSelectedTo = useCallback(
    (targetRotation: Point3D) => {
      const viewer = viewerRef.current
      if (!viewer || !selectedElement) return
      rotateSelectedElement({
        viewer,
        selectedElement,
        targetRotation,
        cubeRegistryRef,
        getElementWorldPosition,
        getBaseCenter,
        applyIfcElementTransform
      })
    },
    [
      applyIfcElementTransform,
      getBaseCenter,
      getElementWorldPosition,
      selectedElement,
      viewerRef
    ]
  )

  const hideIfcElement = useCallback(
    (modelID: number, expressID: number) => {
      const viewer = viewerRef.current
      if (!viewer) return
      // Soft delete: keep subset/material graph intact and hide via visibility filtering.
      ensureBaseSubset(modelID)
      const manager = viewer.IFC.loader.ifcManager
      const scene = viewer.context.getScene()
      const key = getElementKey(modelID, expressID)

      let hidden = hiddenIdsRef.current.get(modelID)
      if (!hidden) {
        hidden = new Set<number>()
        hiddenIdsRef.current.set(modelID, hidden)
      }
      hidden.add(expressID)

      removeMovedSubset({
        modelID,
        key,
        movedSubset: movedSubsetsRef.current.get(key),
        scene,
        manager,
        removePickable: (mesh) => removePickable(viewer, mesh)
      })
      movedSubsetsRef.current.delete(key)
      elementOffsetsRef.current.delete(key)
      elementRotationsRef.current.delete(key)
      spaceBiasIdsRef.current.get(modelID)?.delete(expressID)
      spaceBiasAppliedRef.current.get(modelID)?.delete(expressID)
      const activeFilter = filterIdsRef.current.get(modelID) ?? null
      updateVisibilityForModel(modelID, activeFilter)
      const activeHighlight = highlightedIfcRef.current
      if (activeHighlight && activeHighlight.modelID === modelID && activeHighlight.expressID === expressID) {
        clearIfcSelectionHighlight(modelID)
      }
    },
    [
      clearIfcSelectionHighlight,
      ensureBaseSubset,
      getElementKey,
      removePickable,
      updateVisibilityForModel,
      viewerRef
    ]
  )

  const selectCustomCube = useCallback(
    (expressID: number) => {
      const customObject = cubeRegistryRef.current.get(expressID)
      if (!customObject) return
      clearIfcSelectionHighlight()
      viewerRef.current?.IFC.selector.unpickIfcItems()
      const pos = customObject.position
      const customState = getCustomObjectState(expressID)
      setSelectedElement({
        modelID: CUSTOM_CUBE_MODEL_ID,
        expressID,
        type: customState?.model?.toUpperCase() ?? 'CUSTOM'
      })
      setOffsetInputs(pointToOffsetVector(pos))
      setPropertyFields(buildCustomPropertyFields(expressID))
      setPropertyError(null)
      setIsFetchingProperties(false)
      setCubeHighlight(expressID)
    },
    [buildCustomPropertyFields, clearIfcSelectionHighlight, getCustomObjectState, setCubeHighlight, viewerRef]
  )

  const clearIfcHighlight = useCallback(() => {
    clearIfcSelectionHighlight()
    viewerRef.current?.IFC.selector.unpickIfcItems()
  }, [clearIfcSelectionHighlight, viewerRef])

  const removeCustomCube = useCallback(
    (expressID: number) => {
      const viewer = viewerRef.current
      if (!viewer) return
      removeCustomObject(viewer, customObjectRegistryRefs, expressID, removePickable)
    },
    [customObjectRegistryRefs, removePickable, viewerRef]
  )

  const spawnCubeAt = useCallback(
    (target?: Point3D | null, id?: number): SpawnedCubeInfo | null => {
      const viewer = viewerRef.current
      if (!viewer) return null
      return spawnCubeObject(viewer, customObjectRegistryRefs, target, id)
    },
    [customObjectRegistryRefs, viewerRef]
  )

  const spawnCube = useCallback(
    (target?: Point3D | null, options?: SpawnCubeOptions): SpawnedCubeInfo | null => {
      // Convenience wrapper that also focuses the camera if requested
      const info = spawnCubeAt(target, options?.id)
      if (options?.focus && info) {
        focusOnPoint(info.position)
      }
      return info
    },
    [focusOnPoint, spawnCubeAt]
  )

  const spawnUploadedModel = useCallback(
    async (
      file: File,
      target?: Point3D | null,
      options?: { focus?: boolean }
    ): Promise<SpawnedModelInfo | null> => {
      const viewer = viewerRef.current
      if (!viewer) return null
      try {
        const spawned = await spawnUploadedCustomObject(
          viewer,
          customObjectRegistryRefs,
          file,
          target
        )
        if (options?.focus && spawned) {
          focusOnPoint(spawned.position)
        }
        return spawned
      } catch (err) {
        console.error('Failed to load uploaded model', err)
      }
      return null
    },
    [customObjectRegistryRefs, focusOnPoint, viewerRef]
  )

  const spawnStoredCustomObject = useCallback(
    (args: SpawnStoredCustomObjectArgs): { expressID: number; position: Point3D } | null => {
      const viewer = viewerRef.current
      if (!viewer) return null

      const restored = spawnStoredCustomRegistryObject(viewer, customObjectRegistryRefs, args)
      if (args.focus && restored) {
        focusOnPoint(restored.position)
      }
      return restored
    },
    [customObjectRegistryRefs, focusOnPoint, viewerRef]
  )

  return {
    selectedElement,
    offsetInputs,
    propertyFields,
    propertyError,
    isFetchingProperties,
    handleOffsetInputChange,
    applyOffsetToSelectedElement,
    handleFieldChange,
    handlePick,
    selectById,
    selectCustomCube,
    clearIfcHighlight,
    highlightIfcGroup,
    hasRenderableExpressId,
    removeCustomCube,
    getIfcElementBasePosition,
    getIfcElementPlacementPosition,
    ensureIfcPlacementPosition,
    getIfcElementTranslationDelta,
    getIfcElementRotationDelta,
    getElementWorldPosition,
    moveSelectedTo,
    hideIfcElement,
    setCustomCubeRoomNumber,
    setCustomObjectSpaceIfcId,
    setCustomObjectItemId,
    findCustomObjectExpressIdByItemId,
    getCustomObjectState,
    ensureCustomCubesPickable,
    pickCandidatesAt,
    getSelectedWorldPosition,
    resetSelection,
    clearOffsetArtifacts,
    spawnCube,
    spawnUploadedModel,
    spawnStoredCustomObject,
    applyIfcElementOffset,
    applyIfcElementRotation,
    rotateSelectedTo,
    applyVisibilityFilter,
    configureSpaceBiasTargets
  }
}
