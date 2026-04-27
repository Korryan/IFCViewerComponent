import { useCallback, useState } from 'react'
// Encapsulates selection, IFC property fetching, and offset/subset handling
import { Vector3 } from 'three'
import type { IfcViewerAPI } from '../viewer/IfcViewerAPICompat'
import type {
  FurnitureGeometry,
  OffsetVector,
  Point3D,
  PropertyField,
  SelectedElement
} from '../ifcViewerTypes'
import {
  normalizeCoordinateValue,
  zeroOffset
} from './selectionOffsets.shared'
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
  isIfcSelectionAllowed as isIfcSelectionAllowedInternal
} from './selectionOffsets.ifcTypes'
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
  type CustomObjectState,
  type SpawnedCubeInfo,
  type SpawnedModelInfo
} from './selectionOffsets.customRegistry'
import { useSelectionOffsetRefs } from './useSelectionOffsetRefs'
import { useSelectionOffsetsVisibility } from './useSelectionOffsetsVisibility'
import { useSelectionOffsetsCustomObjects } from './useSelectionOffsetsCustomObjects'

export { CUSTOM_CUBE_MODEL_ID } from './selectionOffsets.shared'
export type { PickCandidate } from './selectionOffsets.picking'

type SpawnCubeOptions = {
  focus?: boolean
  id?: number
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
  // This hook builds the mutable cache refs used by selection, subsets, and custom objects.
  const refs = useSelectionOffsetRefs()
  const {
    propertyRequestRef,
    baseSubsetsRef,
    movedSubsetsRef,
    elementOffsetsRef,
    elementRotationsRef,
    baseCentersRef,
    placementOriginsRef,
    coordinationMatrixRef,
    cubeRegistryRef,
    cubeIdCounterRef,
    filterIdsRef,
    highlightedIfcRef,
    selectionSubsetsRef,
    selectionMaterialRef,
    focusOffsetRef,
    customObjectRegistryRefs
  } = refs

  const [selectedElement, setSelectedElement] = useState<SelectedElement | null>(null)
  const [offsetInputs, setOffsetInputs] = useState<OffsetVector>(zeroOffset)
  const [propertyFields, setPropertyFields] = useState<PropertyField[]>([])
  const [propertyError, setPropertyError] = useState<string | null>(null)
  const [isFetchingProperties, setIsFetchingProperties] = useState(false)
  // This function clears any active IFC highlight subset for the current selection or one specific model.
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

  // This function moves the camera focus to the provided point using the shared viewer navigation helper.
  const focusOnPoint = useCallback((point: Point3D | null) => {
    focusViewerOnPoint(viewerRef.current, point)
  }, [viewerRef])

  // This function updates the highlighted custom object id used by cube and prefab selection.
  const setCubeHighlight = useCallback((expressID: number | null) => {
    setHighlightedCustomObject(customObjectRegistryRefs, expressID)
  }, [customObjectRegistryRefs])

  // This function returns the current world-space position of the selected IFC element or custom object.
  const getSelectedWorldPosition = useCallback((): Vector3 | null => {
    return getSelectedElementWorldPosition({
      selectedElement,
      offsetInputs,
      cubeRegistryRef
    })
  }, [offsetInputs, selectedElement])

  // This function clears inspector state, pending property requests, and active viewer highlights in one step.
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

  // This function builds the stable internal key used to cache per-element transform state.
  const getElementKey = useCallback((modelID: number, expressID: number) => {
    return `${modelID}:${expressID}`
  }, [])

  // This function primes the cached IFC placement origin used to resolve later move deltas consistently.
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

  // This function returns the base model offset derived from the stored base subset for one IFC model.
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

  // This hook builds the visibility, subset, and renderable-id callbacks used by the selection runtime.
  const {
    removePickable,
    registerPickable,
    hasRenderableExpressId,
    ensureBaseSubset,
    clearOffsetArtifacts,
    updateVisibilityForModel,
    applyVisibilityFilter,
    hideIfcElement,
    configureSpaceBiasTargets
  } = useSelectionOffsetsVisibility({
    viewerRef,
    refs,
    getElementKey,
    clearIfcSelectionHighlight
  })

  // This function applies the single-element IFC highlight subset used by the active selection.
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

  // This function highlights a whole IFC group while optionally remembering one anchor express id.
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

  // This function resolves and caches the base center used for IFC transform previews and focusing.
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

  // This function resolves the current world-space position for one IFC element after all applied offsets.
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

  // This function resolves the original base position for one IFC element before editor transforms.
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

  // This function resolves the placement-space position currently used to export one IFC element.
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

  // This function ensures the placement-space position is available even when it must be lazily derived first.
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

  // This function computes the translation delta between the original IFC placement and the current editor position.
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

  // This function returns the current rotation delta stored for one IFC element or custom object.
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

  // This function loads IFC properties for one element and synchronizes the inspector state around that selection.
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
        buildPropertyFields: buildIfcPropertyFields,
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
      getBaseCenter,
      getElementKey,
      getElementWorldPosition,
      getModelBaseOffset,
      primeIfcPlacementOrigin,
      viewerRef
    ]
  )

  // This function updates one editable property field inside the inspector state.
  const handleFieldChange = useCallback((key: string, value: string) => {
    setPropertyFields((prev) => prev.map((field) => (field.key === key ? { ...field, value } : field)))
  }, [])

  // This function updates one coordinate input while normalizing the stored numeric value.
  const handleOffsetInputChange = useCallback((axis: keyof OffsetVector, value: number) => {
    setOffsetInputs((prev) => ({
      ...prev,
      [axis]: normalizeCoordinateValue(value)
    }))
  }, [])

  // This hook builds the custom-object selection and spawn callbacks used by the selection runtime.
  const {
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
  } = useSelectionOffsetsCustomObjects({
    viewerRef,
    customObjectRegistryRefs,
    cubeRegistryRef,
    clearIfcSelectionHighlight,
    focusOnPoint,
    removePickable,
    setSelectedElement,
    setOffsetInputs,
    setPropertyFields,
    setPropertyError,
    setIsFetchingProperties,
    setCubeHighlight
  })

  // This function collects IFC and custom-object pick candidates around one screen-space click position.
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

  // This function applies the current offset and rotation to one IFC element through the moved-subset layer.
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

  // This function updates only the translation part of one IFC element transform.
  const applyIfcElementOffset = useCallback(
    (modelID: number, expressID: number, targetOffset: OffsetVector) => {
      const key = getElementKey(modelID, expressID)
      applyIfcElementTransform(modelID, expressID, targetOffset, elementRotationsRef.current.get(key))
    },
    [applyIfcElementTransform, getElementKey]
  )

  // This function updates only the rotation part of one IFC element transform around its current center.
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

  // This function moves the currently selected IFC element or custom object to the requested offset.
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

  // This function commits the offset currently shown in the inspector inputs onto the selected element.
  const applyOffsetToSelectedElement = useCallback(() => {
    moveSelectedTo(offsetInputs)
  }, [moveSelectedTo, offsetInputs])

  // This function performs the standard click-pick flow for IFC elements and custom objects.
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
        getExpressIdFromHit: getExpressIdFromPickHit,
        isIfcSelectionAllowed: isIfcSelectionAllowedInternal,
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
    resetSelection,
    setCubeHighlight,
    viewerRef
  ])

  // This function selects one IFC element by id, loads its properties, and optionally focuses the camera on it.
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
          isIfcSelectionAllowed: isIfcSelectionAllowedInternal,
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
      resetSelection,
      viewerRef
    ]
  )

  // This function rotates the currently selected IFC element or custom object to the requested angles.
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

  // This function clears every active IFC selection highlight and tells the engine picker to unselect.
  const clearIfcHighlight = useCallback(() => {
    clearIfcSelectionHighlight()
    viewerRef.current?.IFC.selector.unpickIfcItems()
  }, [clearIfcSelectionHighlight, viewerRef])

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
