import { useCallback } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import type { OffsetVector, Point3D, PropertyField, SelectedElement } from '../ifcViewerTypes'
import type { IfcViewerAPI } from '../viewer/IfcViewerAPICompat'
import type { SelectionOffsetRefs } from './useSelectionOffsetRefs'
import { buildPropertyFields as buildIfcPropertyFields } from './selectionOffsets.properties'
import { isIfcSelectionAllowed as isIfcSelectionAllowedInternal } from './selectionOffsets.ifcTypes'
import { fetchSelectionProperties, handleSelectionPick, selectIfcElementById } from './selectionOffsets.selection'
import { useSelectionOffsetsIfcGeometry } from './useSelectionOffsetsIfcGeometry'
import type { CustomObjectState } from './selectionOffsets.customRegistry'

type SetState<T> = Dispatch<SetStateAction<T>>

type UseSelectionOffsetsIfcActionsArgs = {
  viewerRef: { current: IfcViewerAPI | null }
  refs: SelectionOffsetRefs
  selectedElement: SelectedElement | null
  offsetInputs: OffsetVector
  getElementKey: (modelID: number, expressID: number) => string
  getModelBaseOffset: (modelID: number) => OffsetVector
  primeIfcPlacementOrigin: (modelID: number, expressID: number, properties?: any) => Promise<Point3D | null>
  setSelectedElement: SetState<SelectedElement | null>
  setOffsetInputs: SetState<OffsetVector>
  setPropertyFields: SetState<PropertyField[]>
  setPropertyError: SetState<string | null>
  setIsFetchingProperties: SetState<boolean>
  clearIfcSelectionHighlight: (modelID?: number | null) => void
  focusOnPoint: (point: Point3D | null) => void
  setCubeHighlight: (expressID: number | null) => void
  resetSelection: () => void
  buildCustomPropertyFields: (expressID: number) => PropertyField[]
  getCustomObjectState: (expressID: number) => CustomObjectState | null
  hasRenderableExpressId: (modelID: number, expressID: number) => boolean
  ensureBaseSubset: (modelID: number) => any
  registerPickable: (viewer: IfcViewerAPI, mesh: any) => void
  removePickable: (viewer: IfcViewerAPI, mesh: any) => void
  updateVisibilityForModel: (modelID: number, allowedIds: Set<number> | null) => void
}

// Builds the IFC-oriented selection, highlight, and transform callbacks used by the selection hook.
export const useSelectionOffsetsIfcActions = ({
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
}: UseSelectionOffsetsIfcActionsArgs) => {
  const {
    propertyRequestRef,
    cubeRegistryRef,
    cubeIdCounterRef,
    elementOffsetsRef,
    focusOffsetRef
  } = refs

  const {
    applyIfcElementOffset,
    applyIfcElementRotation,
    applyIfcSelectionHighlight,
    clearIfcHighlight,
    clearIfcSelectionHighlightState,
    ensureIfcPlacementPosition,
    getBaseCenter,
    getElementWorldPosition,
    getExpressIdFromPickHit,
    getIfcElementBasePosition,
    getIfcElementPlacementPosition,
    getIfcElementRotationDelta,
    getIfcElementTranslationDelta,
    getSelectedWorldPosition,
    highlightIfcGroup,
    moveSelectedTo,
    pickCandidatesAt,
    rotateSelectedTo
  } = useSelectionOffsetsIfcGeometry({
    viewerRef,
    refs,
    selectedElement,
    offsetInputs,
    getElementKey,
    primeIfcPlacementOrigin,
    setOffsetInputs,
    clearIfcSelectionHighlight,
    hasRenderableExpressId,
    ensureBaseSubset,
    registerPickable,
    removePickable,
    updateVisibilityForModel
  })

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
      elementOffsetsRef,
      focusOffsetRef,
      getBaseCenter,
      getElementKey,
      getElementWorldPosition,
      getModelBaseOffset,
      primeIfcPlacementOrigin,
      propertyRequestRef,
      setIsFetchingProperties,
      setOffsetInputs,
      setPropertyError,
      setPropertyFields,
      setSelectedElement,
      viewerRef
    ]
  )

  // This function performs the standard click-pick flow for IFC elements and custom objects.
  const handlePick = useCallback(
    async (options?: { autoFocus?: boolean; allowedIfcTypes?: string[] }) => {
      const viewer = viewerRef.current
      if (!viewer) return

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
          clearIfcSelectionHighlight: clearIfcSelectionHighlightState,
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
    },
    [
      applyIfcSelectionHighlight,
      buildCustomPropertyFields,
      clearIfcSelectionHighlightState,
      cubeIdCounterRef,
      cubeRegistryRef,
      elementOffsetsRef,
      fetchProperties,
      focusOnPoint,
      getCustomObjectState,
      getElementWorldPosition,
      getExpressIdFromPickHit,
      resetSelection,
      setCubeHighlight,
      setIsFetchingProperties,
      setOffsetInputs,
      setPropertyError,
      setPropertyFields,
      setSelectedElement,
      viewerRef
    ]
  )

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
          clearIfcSelectionHighlight: clearIfcSelectionHighlightState,
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
      clearIfcSelectionHighlightState,
      elementOffsetsRef,
      fetchProperties,
      focusOnPoint,
      getBaseCenter,
      getElementKey,
      getElementWorldPosition,
      getModelBaseOffset,
      hasRenderableExpressId,
      resetSelection,
      setIsFetchingProperties,
      setOffsetInputs,
      setPropertyError,
      setPropertyFields,
      setSelectedElement,
      viewerRef
    ]
  )

  return {
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
  }
}
