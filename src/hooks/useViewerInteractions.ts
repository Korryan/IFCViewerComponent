import { useCallback, useEffect, useRef, useState } from 'react'
import type { IfcViewerAPI } from '../viewer/IfcViewerAPICompat'
import type { Point3D } from '../ifcViewerTypes'
import {
  applyNavigationControls,
  moveCameraAlongView as moveCameraAlongViewInternal,
  moveCameraToPoint as moveCameraToPointInternal,
  teleportCameraToPoint as teleportCameraToPointInternal,
  type NavigationMode
} from './viewerInteractions.camera'
import { readHoverCoords } from './viewerInteractions.hover'
import { useViewerKeyboardShortcuts } from './useViewerKeyboardShortcuts'
import type { UseViewerInteractionsArgs, UseViewerInteractionsResult } from './useViewerInteractions.types'
import { useViewerTransformState } from './useViewerTransformState'
import { useViewerWalkControls } from './useViewerWalkControls'
import { useViewerPickMenu } from './useViewerPickMenu'
import { useViewerPointerInteractions } from './useViewerPointerInteractions'

export type { NavigationMode } from './viewerInteractions.camera'

export const useViewerInteractions = ({
  containerRef,
  viewerRef,
  ensureViewer,
  selectedElement,
  offsetInputs,
  showShortcuts,
  canTransformSelected,
  getSelectedWorldPosition,
  getIfcElementRotationDelta,
  moveSelectedTo,
  rotateSelectedTo,
  resetSelection,
  selectById,
  selectCustomCube,
  pickCandidatesAt,
  syncSelectedCubePosition,
  syncSelectedIfcPosition,
  pushHistoryEntry
}: UseViewerInteractionsArgs): UseViewerInteractionsResult => {
  const lastPointerPosRef = useRef<{ x: number; y: number }>({ x: 16, y: 16 })
  const [navigationMode, setNavigationMode] = useState<NavigationMode>('free')
  const [hoverCoords, setHoverCoords] = useState<Point3D | null>(null)
  const [isInsertMenuOpen, setIsInsertMenuOpen] = useState(false)
  const [insertMenuAnchor, setInsertMenuAnchor] = useState<{ x: number; y: number } | null>(null)
  const [insertTargetCoords, setInsertTargetCoords] = useState<Point3D | null>(null)
  const [isShortcutsOpen, setIsShortcutsOpen] = useState(false)
  const navigationModeRef = useRef<NavigationMode>(navigationMode)
  const {
    dragAxisLock,
    dragModeStartOffsetRef,
    dragPlaneRef,
    dragStartOffsetRef,
    dragStartPointRef,
    finishDragMode,
    finishRotateMode,
    isDragging,
    isRotating,
    rotateAxisLock,
    rotateCurrentValueRef,
    rotateStartPointerRef,
    rotateStartValueRef,
    setDragAxisLock,
    setIsDragging,
    setIsRotating,
    setRotateAxisLock,
    suppressNextSelectionClickRef
  } = useViewerTransformState({
    offsetInputs,
    moveSelectedTo,
    pushHistoryEntry,
    rotateSelectedTo,
    selectedElement,
    syncSelectedCubePosition,
    syncSelectedIfcPosition
  })

  const isWalkMode = navigationMode === 'walk'

  // This function switches the viewer between free and walk navigation modes.
  const toggleNavigationMode = useCallback(() => {
    setNavigationMode((prev) => (prev === 'free' ? 'walk' : 'free'))
  }, [])

  useEffect(() => {
    navigationModeRef.current = navigationMode
  }, [navigationMode])

  useEffect(() => {
    if (!showShortcuts && isShortcutsOpen) {
      setIsShortcutsOpen(false)
    }
  }, [isShortcutsOpen, showShortcuts])

  const { stopWalkMovementLoop, walkKeyStateRef } = useViewerWalkControls({
    containerRef,
    isWalkMode,
    viewerRef
  })

  // This function applies the current navigation mode to the viewer camera controls on demand.
  const applyNavigationMode = useCallback((viewer: IfcViewerAPI) => {
    applyNavigationControls(viewer, navigationModeRef.current)
  }, [])

  // This function closes the insert menu and clears its anchor and target state.
  const closeInsertMenu = useCallback(() => {
    setIsInsertMenuOpen(false)
    setInsertMenuAnchor(null)
    setInsertTargetCoords(null)
  }, [])

  // This function teleports the camera directly to the provided world point without animation.
  const teleportCameraToPoint = useCallback((point: Point3D | null) => {
    return teleportCameraToPointInternal(viewerRef.current, point)
  }, [viewerRef])

  // This function moves the camera smoothly toward the provided world point when the viewer supports it.
  const moveCameraToPoint = useCallback((point: Point3D | null) => {
    return moveCameraToPointInternal(viewerRef.current, point)
  }, [viewerRef])

  // This function zooms by pushing the camera forward or backward along its current view direction.
  const moveCameraAlongView = useCallback((rawWheelDelta: number) => {
    return moveCameraAlongViewInternal(viewerRef.current, rawWheelDelta)
  }, [viewerRef])

  const {
    closePickMenu,
    handlePickMenuSelect,
    isPickMenuOpen,
    openSelectionAt,
    pickMenuAnchor,
    pickMenuItems
  } = useViewerPickMenu({
    pickCandidatesAt,
    resetSelection,
    selectById,
    selectCustomCube,
    viewerRef
  })

  // This function updates the cached hover coordinates from the current IFC raycast hit under the cursor.
  const updateHoverCoords = useCallback(() => {
    setHoverCoords(readHoverCoords(viewerRef.current))
  }, [viewerRef])

  // This effect keeps the viewer camera bindings synchronized whenever the active navigation mode changes.
  useEffect(() => {
    const viewer = viewerRef.current ?? ensureViewer()
    if (!viewer) return
    applyNavigationControls(viewer, navigationMode)
    if (!isWalkMode) {
      stopWalkMovementLoop()
    }
  }, [ensureViewer, isWalkMode, navigationMode, stopWalkMovementLoop, viewerRef])

  useViewerPointerInteractions({
    containerRef,
    dragAxisLock,
    dragPlaneRef,
    dragStartOffsetRef,
    dragStartPointRef,
    finishDragMode,
    finishRotateMode,
    isDragging,
    isRotating,
    isWalkMode,
    lastPointerPosRef,
    moveCameraAlongView,
    moveSelectedTo,
    openSelectionAt,
    rotateAxisLock,
    rotateCurrentValueRef,
    rotateSelectedTo,
    rotateStartPointerRef,
    rotateStartValueRef,
    suppressNextSelectionClickRef,
    updateHoverCoords,
    viewerRef
  })

  // This effect registers the global keyboard shortcut layer that drives insert, transform, and walk controls.
  useViewerKeyboardShortcuts({
    canTransformSelected,
    closeInsertMenu,
    closePickMenu,
    containerRef,
    dragModeStartOffsetRef,
    dragPlaneRef,
    dragStartOffsetRef,
    dragStartPointRef,
    finishDragMode,
    finishRotateMode,
    getIfcElementRotationDelta,
    getSelectedWorldPosition,
    hoverCoords,
    isDragging,
    isRotating,
    isWalkMode,
    lastPointerPosRef,
    offsetInputs,
    rotateCurrentValueRef,
    rotateStartPointerRef,
    rotateStartValueRef,
    selectedElement,
    showShortcuts,
    setDragAxisLock,
    setInsertMenuAnchor,
    setInsertTargetCoords,
    setIsDragging,
    setIsInsertMenuOpen,
    setIsRotating,
    setIsShortcutsOpen,
    setRotateAxisLock,
    toggleNavigationMode,
    viewerRef,
    walkKeyStateRef
  })

  // This effect immediately reverts any active transform preview when the current selection becomes non-editable.
  useEffect(() => {
    if (canTransformSelected) return
    if (isRotating) {
      finishRotateMode({ revert: true })
    }
    if (isDragging) {
      finishDragMode({ revert: true })
    }
  }, [canTransformSelected, finishDragMode, finishRotateMode, isDragging, isRotating])

  return {
    navigationMode,
    isWalkMode,
    toggleNavigationMode,
    setNavigationMode,
    applyNavigationMode,
    stopWalkMovementLoop,
    hoverCoords,
    isInsertMenuOpen,
    insertMenuAnchor,
    insertTargetCoords,
    closeInsertMenu,
    isShortcutsOpen,
    setIsShortcutsOpen,
    isPickMenuOpen,
    pickMenuAnchor,
    pickMenuItems,
    closePickMenu,
    handlePickMenuSelect,
    moveCameraToPoint,
    teleportCameraToPoint
  }
}
