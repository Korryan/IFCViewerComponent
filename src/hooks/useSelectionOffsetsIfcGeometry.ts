import { useCallback } from 'react'
import type { OffsetVector, Point3D, SelectedElement } from '../ifcViewerTypes'
import type { IfcViewerAPI } from '../viewer/IfcViewerAPICompat'
import type { SelectionOffsetRefs } from './useSelectionOffsetRefs'
import {
  applyIfcSelectionHighlight as applyIfcSelectionHighlightInternal,
  clearIfcSelectionHighlightState as clearIfcSelectionHighlightInternal,
  highlightIfcGroup as highlightIfcGroupInternal
} from './selectionOffsets.highlight'
import {
  getExpressIdFromHit as getExpressIdFromPickHit,
  pickCandidatesAtPoint,
  type PickCandidate
} from './selectionOffsets.picking'
import {
  ensureIfcPlacementPosition as ensureIfcPlacementPositionInternal,
  getBaseCenter as getBaseCenterInternal,
  getElementWorldPosition as getElementWorldPositionInternal,
  getIfcElementBasePosition as getIfcElementBasePositionInternal,
  getIfcElementPlacementPosition as getIfcElementPlacementPositionInternal,
  getIfcElementRotationDelta as getIfcElementRotationDeltaInternal,
  getIfcElementTranslationDelta as getIfcElementTranslationDeltaInternal
} from './selectionOffsets.placement'
import {
  applyIfcElementTransform as applyIfcElementTransformInternal,
  moveSelectedElement,
  rotateSelectedElement
} from './selectionOffsets.transforms'
import { getSelectedElementWorldPosition } from './selectionOffsets.ui'

type UseSelectionOffsetsIfcGeometryArgs = {
  viewerRef: { current: IfcViewerAPI | null }
  refs: SelectionOffsetRefs
  selectedElement: SelectedElement | null
  offsetInputs: OffsetVector
  getElementKey: (modelID: number, expressID: number) => string
  primeIfcPlacementOrigin: (modelID: number, expressID: number, properties?: any) => Promise<Point3D | null>
  setOffsetInputs: (value: OffsetVector | ((prev: OffsetVector) => OffsetVector)) => void
  clearIfcSelectionHighlight: (modelID?: number | null) => void
  hasRenderableExpressId: (modelID: number, expressID: number) => boolean
  ensureBaseSubset: (modelID: number) => any
  registerPickable: (viewer: IfcViewerAPI, mesh: any) => void
  removePickable: (viewer: IfcViewerAPI, mesh: any) => void
  updateVisibilityForModel: (modelID: number, allowedIds: Set<number> | null) => void
}

// Builds the IFC geometry, highlight, and transform callbacks used by the selection action hook.
export const useSelectionOffsetsIfcGeometry = ({
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
}: UseSelectionOffsetsIfcGeometryArgs) => {
  const {
    baseSubsetsRef,
    movedSubsetsRef,
    elementOffsetsRef,
    elementRotationsRef,
    baseCentersRef,
    placementOriginsRef,
    cubeRegistryRef,
    filterIdsRef,
    highlightedIfcRef,
    selectionSubsetsRef,
    selectionMaterialRef,
    focusOffsetRef
  } = refs

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
    [
      baseSubsetsRef,
      getElementKey,
      hasRenderableExpressId,
      highlightedIfcRef,
      movedSubsetsRef,
      selectionMaterialRef,
      selectionSubsetsRef,
      viewerRef
    ]
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
    [
      baseSubsetsRef,
      getElementKey,
      hasRenderableExpressId,
      highlightedIfcRef,
      movedSubsetsRef,
      selectionMaterialRef,
      selectionSubsetsRef,
      viewerRef
    ]
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
    [baseCentersRef, getElementKey, hasRenderableExpressId, viewerRef]
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
    [cubeRegistryRef, elementOffsetsRef, getBaseCenter, getElementKey]
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
    [cubeRegistryRef, getBaseCenter]
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
    [
      baseSubsetsRef,
      elementOffsetsRef,
      getBaseCenter,
      getElementKey,
      movedSubsetsRef,
      placementOriginsRef,
      viewerRef
    ]
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
    [
      elementOffsetsRef,
      getBaseCenter,
      getElementKey,
      getIfcElementPlacementPosition,
      placementOriginsRef
    ]
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
    [cubeRegistryRef, elementRotationsRef, getElementKey]
  )

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
    [cubeRegistryRef, viewerRef]
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
      elementOffsetsRef,
      elementRotationsRef,
      ensureBaseSubset,
      filterIdsRef,
      getBaseCenter,
      getElementKey,
      hasRenderableExpressId,
      highlightedIfcRef,
      movedSubsetsRef,
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
    [applyIfcElementTransform, elementRotationsRef, getElementKey]
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
      cubeRegistryRef,
      elementOffsetsRef,
      focusOffsetRef,
      selectedElement,
      setOffsetInputs,
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
      cubeRegistryRef,
      getBaseCenter,
      getElementWorldPosition,
      selectedElement,
      viewerRef
    ]
  )

  // This function returns the current world-space position of the selected IFC element or custom object.
  const getSelectedWorldPosition = useCallback(() => {
    return getSelectedElementWorldPosition({
      selectedElement,
      offsetInputs,
      cubeRegistryRef
    })
  }, [cubeRegistryRef, offsetInputs, selectedElement])

  // This function clears every active IFC selection highlight and tells the engine picker to unselect.
  const clearIfcHighlight = useCallback(() => {
    clearIfcSelectionHighlightInternal({
      viewer: viewerRef.current,
      selectionSubsetsRef,
      highlightedIfcRef
    })
    viewerRef.current?.IFC.selector.unpickIfcItems()
  }, [highlightedIfcRef, selectionSubsetsRef, viewerRef])

  return {
    applyIfcElementOffset,
    applyIfcElementRotation,
    applyIfcElementTransform,
    applyIfcSelectionHighlight,
    clearIfcHighlight,
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
    rotateSelectedTo,
    ensureIfcPlacementPosition,
    clearIfcSelectionHighlightState: clearIfcSelectionHighlight
  }
}
