import { useEffect } from 'react'
import type { Dispatch, MutableRefObject, SetStateAction } from 'react'
import type { Plane, Vector3 } from 'three'
import type { OffsetVector, Point3D, SelectedElement } from '../ifcViewerTypes'
import type { IfcViewerAPI } from '../viewer/IfcViewerAPICompat'
import { CUSTOM_CUBE_MODEL_ID } from './useSelectionOffsets'
import { emptyWalkKeyState, getWalkMoveKey, type WalkMoveKey } from './viewerInteractions.camera'
import {
  cloneOffsetVector,
  clonePoint3D,
  createFloorDragSetup,
  createViewDragSetup,
  getRotationStartPointer,
  getRotationStartValue,
  isEditableEventTarget,
  isTransformAxisKey,
  type TransformAxisLock
} from './viewerInteractions.transform'

type UseViewerKeyboardShortcutsArgs = {
  canTransformSelected: boolean
  closeInsertMenu: () => void
  closePickMenu: () => void
  containerRef: MutableRefObject<HTMLDivElement | null>
  dragModeStartOffsetRef: MutableRefObject<OffsetVector | null>
  dragPlaneRef: MutableRefObject<Plane | null>
  dragStartOffsetRef: MutableRefObject<OffsetVector | null>
  dragStartPointRef: MutableRefObject<Vector3 | null>
  finishDragMode: (options?: { commit?: boolean; revert?: boolean }) => void
  finishRotateMode: (options?: { commit?: boolean; revert?: boolean }) => void
  getIfcElementRotationDelta: (modelID: number, expressID: number) => Point3D | null
  getSelectedWorldPosition: () => Vector3 | null
  hoverCoords: Point3D | null
  isDragging: boolean
  isRotating: boolean
  isWalkMode: boolean
  lastPointerPosRef: MutableRefObject<{ x: number; y: number }>
  offsetInputs: OffsetVector
  rotateCurrentValueRef: MutableRefObject<Point3D | null>
  rotateStartPointerRef: MutableRefObject<{ x: number; y: number } | null>
  rotateStartValueRef: MutableRefObject<Point3D | null>
  selectedElement: SelectedElement | null
  setDragAxisLock: Dispatch<SetStateAction<TransformAxisLock>>
  setInsertMenuAnchor: Dispatch<SetStateAction<{ x: number; y: number } | null>>
  setInsertTargetCoords: Dispatch<SetStateAction<Point3D | null>>
  setIsDragging: Dispatch<SetStateAction<boolean>>
  setIsInsertMenuOpen: Dispatch<SetStateAction<boolean>>
  setIsRotating: Dispatch<SetStateAction<boolean>>
  setIsShortcutsOpen: Dispatch<SetStateAction<boolean>>
  setRotateAxisLock: Dispatch<SetStateAction<TransformAxisLock>>
  showShortcuts?: boolean
  toggleNavigationMode: () => void
  viewerRef: MutableRefObject<IfcViewerAPI | null>
  walkKeyStateRef: MutableRefObject<Record<WalkMoveKey, boolean>>
}

// This hook owns the global keyboard shortcuts that drive viewer navigation, insert mode, and transforms.
export const useViewerKeyboardShortcuts = ({
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
  setDragAxisLock,
  setInsertMenuAnchor,
  setInsertTargetCoords,
  setIsDragging,
  setIsInsertMenuOpen,
  setIsRotating,
  setIsShortcutsOpen,
  setRotateAxisLock,
  showShortcuts,
  toggleNavigationMode,
  viewerRef,
  walkKeyStateRef
}: UseViewerKeyboardShortcutsArgs): void => {
  // This function opens the insert menu at the last pointer position and resolves its target coordinates.
  const openInsertMenuAtPointer = () => {
    const container = containerRef.current
    if (container) {
      const rect = container.getBoundingClientRect()
      const x = Math.max(0, Math.min(lastPointerPosRef.current.x, rect.width))
      const y = Math.max(0, Math.min(lastPointerPosRef.current.y, rect.height))
      setInsertMenuAnchor({
        x: x + 12,
        y: y - 4
      })
    } else {
      setInsertMenuAnchor({ x: 16, y: 16 })
    }

    const viewer = viewerRef.current
    const hit = viewer?.context.castRayIfc()
    const point =
      hit?.point ??
      hoverCoords ?? {
        x: 0,
        y: 0,
        z: 0
      }
    setInsertTargetCoords(point ? { x: point.x, y: point.y, z: point.z } : null)
    setIsInsertMenuOpen(true)
  }

  // This function initializes rotate mode from the current pointer location and stored element rotation.
  const startRotateMode = () => {
    if (!selectedElement || !canTransformSelected) return
    rotateStartPointerRef.current = getRotationStartPointer(containerRef.current, lastPointerPosRef.current)
    const startRotation = getRotationStartValue(selectedElement, getIfcElementRotationDelta)
    rotateStartValueRef.current = clonePoint3D(startRotation)
    rotateCurrentValueRef.current = clonePoint3D(startRotation)
    setIsDragging(false)
    setDragAxisLock(null)
    dragPlaneRef.current = null
    dragStartPointRef.current = null
    dragStartOffsetRef.current = null
    setIsRotating(true)
    setRotateAxisLock(null)
  }

  // This function initializes free drag mode using the active camera plane and current object offset.
  const startViewDragMode = () => {
    if (!selectedElement || !canTransformSelected) return
    const viewer = viewerRef.current
    const currentPos = getSelectedWorldPosition()
    if (!viewer || !currentPos) return
    const dragSetup = createViewDragSetup(viewer, currentPos, selectedElement, CUSTOM_CUBE_MODEL_ID)
    dragPlaneRef.current = dragSetup.plane
    dragStartPointRef.current = dragSetup.startPoint
    dragStartOffsetRef.current = cloneOffsetVector(offsetInputs)
    dragModeStartOffsetRef.current = cloneOffsetVector(offsetInputs)
    setIsDragging(true)
    setDragAxisLock(null)
  }

  // This function snaps the active drag mode onto a horizontal plane while preserving the current offset baseline.
  const startFloorDragMode = () => {
    const viewer = viewerRef.current
    const currentPos = getSelectedWorldPosition()
    if (!viewer || !currentPos) return
    const dragSetup = createFloorDragSetup(
      viewer,
      currentPos,
      containerRef.current,
      lastPointerPosRef.current
    )
    dragPlaneRef.current = dragSetup.plane
    dragStartPointRef.current = dragSetup.startPoint
    dragStartOffsetRef.current = cloneOffsetVector(offsetInputs)
    setDragAxisLock(null)
  }

  // This function closes transient viewer overlays and reverts any unfinished transform sessions.
  const cancelTransientModes = () => {
    closeInsertMenu()
    finishDragMode({ revert: true })
    finishRotateMode({ revert: true })
    setIsShortcutsOpen(false)
    closePickMenu()
  }

  useEffect(() => {
    // This function routes each key press into the matching viewer action or transform mode.
    const handleKeyDown = (event: KeyboardEvent) => {
      if (isEditableEventTarget(event.target)) return
      const key = event.key.toLowerCase()
      const walkMoveKey = getWalkMoveKey(event)

      if (isWalkMode && walkMoveKey) {
        walkKeyStateRef.current[walkMoveKey] = true
        event.preventDefault()
        return
      }

      if (showShortcuts && (event.key === '?' || key === 'h')) {
        setIsShortcutsOpen((prev) => !prev)
        return
      }
      if (key === 'm') {
        toggleNavigationMode()
        return
      }
      if (key === 'r') {
        startRotateMode()
        event.preventDefault()
        return
      }
      if (!isWalkMode && key === 'a') {
        openInsertMenuAtPointer()
      }
      if (key === 'g') {
        startViewDragMode()
      }
      if (isDragging && key === 'f') {
        startFloorDragMode()
      }
      if (isRotating && isTransformAxisKey(key)) {
        setRotateAxisLock(key)
      }
      if (isDragging && isTransformAxisKey(key)) {
        setDragAxisLock(key)
      }
      if (event.key === 'Escape') {
        cancelTransientModes()
      }
    }

    // This function releases walk movement keys as soon as the browser reports the matching keyup event.
    const handleKeyUp = (event: KeyboardEvent) => {
      const walkMoveKey = getWalkMoveKey(event)
      if (walkMoveKey) {
        walkKeyStateRef.current[walkMoveKey] = false
      }
    }

    // This function clears pressed-key state and reverts unfinished transforms when the window loses focus.
    const handleWindowBlur = () => {
      walkKeyStateRef.current = { ...emptyWalkKeyState }
      if (isDragging) {
        finishDragMode({ revert: true })
      }
      if (isRotating) {
        finishRotateMode({ revert: true })
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)
    window.addEventListener('blur', handleWindowBlur)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
      window.removeEventListener('blur', handleWindowBlur)
    }
  }, [
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
    setDragAxisLock,
    setInsertMenuAnchor,
    setInsertTargetCoords,
    setIsDragging,
    setIsInsertMenuOpen,
    setIsRotating,
    setIsShortcutsOpen,
    setRotateAxisLock,
    showShortcuts,
    toggleNavigationMode,
    viewerRef,
    walkKeyStateRef
  ])
}
