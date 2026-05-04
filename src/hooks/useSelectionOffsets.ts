import { useCallback, useState } from 'react'
import type { IfcViewerAPI } from '../viewer/IfcViewerAPICompat'
import type { OffsetVector, Point3D, PropertyField, SelectedElement } from '../ifcViewerTypes'
import { normalizeCoordinateValue, zeroOffset } from './selectionOffsets.shared'
import {
  getModelBaseOffset as getModelBaseOffsetInternal,
  primeIfcPlacementOrigin as primeIfcPlacementOriginInternal
} from './selectionOffsets.placement'
import { focusViewerOnPoint, resetSelectionState, setHighlightedCustomObject } from './selectionOffsets.ui'
import { clearIfcSelectionHighlightState as clearIfcSelectionHighlightInternal } from './selectionOffsets.highlight'
import type { PickCandidate } from './selectionOffsets.picking'
import { type CustomObjectState } from './selectionOffsets.customRegistry'
import { useSelectionOffsetRefs } from './useSelectionOffsetRefs'
import { useSelectionOffsetsVisibility } from './useSelectionOffsetsVisibility'
import { useSelectionOffsetsCustomObjects } from './useSelectionOffsetsCustomObjects'
import { useSelectionOffsetsIfcActions } from './useSelectionOffsetsIfcActions'
import type { UseSelectionOffsetsResult } from './useSelectionOffsets.types'

export { CUSTOM_CUBE_MODEL_ID } from './selectionOffsets.shared'
export type { PickCandidate } from './selectionOffsets.picking'

// Encapsulates selection, IFC property fetching, and offset/subset handling.
export const useSelectionOffsets = (
  viewerRef: { current: IfcViewerAPI | null }
): UseSelectionOffsetsResult => {
  // This hook builds the mutable cache refs used by selection, subsets, and custom objects.
  const refs = useSelectionOffsetRefs()
  const {
    propertyRequestRef,
    baseSubsetsRef,
    placementOriginsRef,
    coordinationMatrixRef,
    cubeRegistryRef,
    highlightedIfcRef,
    selectionSubsetsRef,
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
    [highlightedIfcRef, selectionSubsetsRef, viewerRef]
  )

  // This function moves the camera focus to the provided point using the shared viewer navigation helper.
  const focusOnPoint = useCallback((point: Point3D | null) => {
    focusViewerOnPoint(viewerRef.current, point)
  }, [viewerRef])

  // This function updates the highlighted custom object id used by cube and prefab selection.
  const setCubeHighlight = useCallback((expressID: number | null) => {
    setHighlightedCustomObject(customObjectRegistryRefs, expressID)
  }, [customObjectRegistryRefs])

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
  }, [
    clearIfcSelectionHighlight,
    customObjectRegistryRefs,
    focusOffsetRef,
    propertyRequestRef,
    viewerRef
  ])

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
    [coordinationMatrixRef, getElementKey, placementOriginsRef, viewerRef]
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
    [baseSubsetsRef, viewerRef]
  )

  // This hook builds the visibility, subset, and renderable-id callbacks used by the selection runtime.
  const {
    removePickable,
    registerPickable,
    hasRenderableExpressId,
    ensureBaseSubset,
    clearCustomObjects,
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

  // This hook builds the IFC selection, highlight, and transform callbacks used by the main runtime.
  const {
    applyIfcElementOffset,
    applyIfcElementRotation,
    clearIfcHighlight,
    ensureIfcPlacementPosition,
    getElementWorldPosition,
    getIfcElementBasePosition,
    getIfcElementPlacementPosition,
    getIfcElementRotationDelta,
    getIfcElementTranslationDelta,
    getSelectedWorldPosition,
    handlePick,
    highlightIfcGroup,
    moveSelectedTo,
    pickCandidatesAt,
    rotateSelectedTo,
    selectById
  } = useSelectionOffsetsIfcActions({
    viewerRef,
    refs,
    selectedElement,
    offsetInputs,
    getElementKey,
    getModelBaseOffset,
    primeIfcPlacementOrigin,
    setSelectedElement,
    setOffsetInputs,
    setPropertyFields,
    setPropertyError,
    setIsFetchingProperties,
    clearIfcSelectionHighlight,
    focusOnPoint,
    setCubeHighlight,
    resetSelection,
    buildCustomPropertyFields,
    getCustomObjectState,
    hasRenderableExpressId,
    ensureBaseSubset,
    registerPickable,
    removePickable,
    updateVisibilityForModel
  })

  // This function commits the offset currently shown in the inspector inputs onto the selected element.
  const applyOffsetToSelectedElement = useCallback(() => {
    moveSelectedTo(offsetInputs)
  }, [moveSelectedTo, offsetInputs])

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
    getIfcElementBasePosition,
    getIfcElementPlacementPosition,
    ensureIfcPlacementPosition,
    getIfcElementTranslationDelta,
    getIfcElementRotationDelta,
    getElementWorldPosition,
    moveSelectedTo,
    applyIfcElementOffset,
    applyIfcElementRotation,
    rotateSelectedTo,
    hideIfcElement,
    setCustomCubeRoomNumber,
    setCustomObjectSpaceIfcId,
    setCustomObjectItemId,
    findCustomObjectExpressIdByItemId,
    getCustomObjectState: getCustomObjectState as (expressID: number) => CustomObjectState | null,
    ensureCustomCubesPickable,
    pickCandidatesAt: pickCandidatesAt as (
      clientX: number,
      clientY: number,
      container: HTMLElement,
      maxDistance?: number
    ) => PickCandidate[],
    getSelectedWorldPosition,
    resetSelection,
    clearCustomObjects,
    clearOffsetArtifacts,
    spawnCube,
    removeCustomCube,
    spawnUploadedModel,
    spawnStoredCustomObject,
    applyVisibilityFilter,
    configureSpaceBiasTargets
  }
}
