import { useEffect } from 'react'
import type { MutableRefObject } from 'react'
import type { Plane, Vector3 } from 'three'
import { ROTATE_DRAG_SENSITIVITY } from '../ifcViewer.constants'
import type { OffsetVector, Point3D } from '../ifcViewerTypes'
import type { IfcViewerAPI } from '../viewer/IfcViewerAPICompat'
import {
  applyAxisLockToDragDelta,
  computeNextRotation,
  intersectPointerWithPlane
} from './viewerInteractions.transform'

type AxisLock = 'x' | 'y' | 'z' | null

type UseViewerPointerInteractionsArgs = {
  containerRef: MutableRefObject<HTMLDivElement | null>
  dragAxisLock: AxisLock
  dragPlaneRef: MutableRefObject<Plane | null>
  dragStartOffsetRef: MutableRefObject<OffsetVector | null>
  dragStartPointRef: MutableRefObject<Vector3 | null>
  finishDragMode: (options?: { commit?: boolean; revert?: boolean }) => void
  finishRotateMode: (options?: { commit?: boolean; revert?: boolean }) => void
  isDragging: boolean
  isRotating: boolean
  isWalkMode: boolean
  lastPointerPosRef: MutableRefObject<{ x: number; y: number }>
  moveCameraAlongView: (rawWheelDelta: number) => boolean
  moveSelectedTo: (targetOffset: OffsetVector) => void
  openSelectionAt: (clientX: number, clientY: number, container: HTMLElement) => void
  rotateAxisLock: AxisLock
  rotateCurrentValueRef: MutableRefObject<Point3D | null>
  rotateSelectedTo: (targetRotation: Point3D) => void
  rotateStartPointerRef: MutableRefObject<{ x: number; y: number } | null>
  rotateStartValueRef: MutableRefObject<Point3D | null>
  suppressNextSelectionClickRef: MutableRefObject<boolean>
  updateHoverCoords: () => void
  viewerRef: MutableRefObject<IfcViewerAPI | null>
}

// This hook owns pointer movement, click selection, transform preview, and wheel zoom for the viewer canvas.
export const useViewerPointerInteractions = ({
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
}: UseViewerPointerInteractionsArgs): void => {
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    // This function commits the active transform session before the browser emits the matching click event.
    const handlePointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return
      if (isDragging) {
        suppressNextSelectionClickRef.current = true
        finishDragMode({ commit: true })
        event.preventDefault()
        return
      }
      if (isRotating) {
        suppressNextSelectionClickRef.current = true
        finishRotateMode({ commit: true })
        event.preventDefault()
      }
    }

    // This function either consumes the click after a transform commit or resolves the normal object selection path.
    const handleClick = (event: MouseEvent) => {
      if (event.button !== 0) return
      if (suppressNextSelectionClickRef.current) {
        suppressNextSelectionClickRef.current = false
        event.preventDefault()
        return
      }
      openSelectionAt(event.clientX, event.clientY, container)
      event.preventDefault()
    }

    container.addEventListener('pointerdown', handlePointerDown)
    container.addEventListener('click', handleClick)
    return () => {
      container.removeEventListener('pointerdown', handlePointerDown)
      container.removeEventListener('click', handleClick)
    }
  }, [
    containerRef,
    finishDragMode,
    finishRotateMode,
    isDragging,
    isRotating,
    openSelectionAt,
    suppressNextSelectionClickRef
  ])

  useEffect(() => {
    if (isWalkMode) return
    const container = containerRef.current
    if (!container) return

    // This function moves the camera forward or backward along its view direction when the mouse wheel is used.
    const handleWheel = (event: WheelEvent) => {
      if (event.ctrlKey || event.metaKey) return
      const deltaMultiplier = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 120 : 1
      const normalizedDelta = event.deltaY * deltaMultiplier
      const changed = moveCameraAlongView(normalizedDelta)
      if (changed) {
        event.preventDefault()
      }
    }

    container.addEventListener('wheel', handleWheel, { passive: false })
    return () => {
      container.removeEventListener('wheel', handleWheel)
    }
  }, [containerRef, isWalkMode, moveCameraAlongView])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    // This function caches the latest pointer position in viewer-local coordinates for later keyboard actions.
    const updateLastPointerPosition = (event: PointerEvent) => {
      const rect = container.getBoundingClientRect()
      lastPointerPosRef.current = {
        x: Math.max(0, Math.min(event.clientX - rect.left, rect.width)),
        y: Math.max(0, Math.min(event.clientY - rect.top, rect.height))
      }
    }

    // This function previews the current rotation transform from pointer movement and the active axis lock.
    const previewRotation = (event: PointerEvent) => {
      const startPointer = rotateStartPointerRef.current
      const startRotation = rotateStartValueRef.current
      if (!startPointer || !startRotation) {
        return
      }

      const deltaX = event.clientX - startPointer.x
      const deltaY = event.clientY - startPointer.y
      const nextRotation = computeNextRotation(
        startRotation,
        deltaX,
        deltaY,
        rotateAxisLock,
        ROTATE_DRAG_SENSITIVITY
      )
      rotateCurrentValueRef.current = nextRotation
      rotateSelectedTo(nextRotation)
      event.preventDefault()
    }

    // This function previews the current drag transform by intersecting the pointer ray with the active drag plane.
    const previewDrag = (event: PointerEvent) => {
      const viewer = viewerRef.current
      const plane = dragPlaneRef.current
      if (!viewer || !plane) return

      const rect = container.getBoundingClientRect()
      const hitPoint = intersectPointerWithPlane(viewer, plane, event.clientX, event.clientY, rect)
      if (!hitPoint || !dragStartPointRef.current || !dragStartOffsetRef.current) {
        return
      }

      const delta = applyAxisLockToDragDelta(hitPoint.clone().sub(dragStartPointRef.current), dragAxisLock)
      const newOffset = {
        dx: dragStartOffsetRef.current.dx + delta.x,
        dy: dragStartOffsetRef.current.dy + delta.y,
        dz: dragStartOffsetRef.current.dz + delta.z
      }
      moveSelectedTo(newOffset)
    }

    // This function routes pointer motion into rotate preview, drag preview, or plain hover tracking.
    const handlePointerMove = (event: PointerEvent) => {
      updateLastPointerPosition(event)
      if (isRotating) {
        previewRotation(event)
      } else if (isDragging) {
        previewDrag(event)
      } else if (isWalkMode) {
        return
      } else {
        updateHoverCoords()
      }
    }

    container.addEventListener('pointermove', handlePointerMove)
    return () => {
      container.removeEventListener('pointermove', handlePointerMove)
    }
  }, [
    containerRef,
    dragAxisLock,
    dragPlaneRef,
    dragStartOffsetRef,
    dragStartPointRef,
    isDragging,
    isRotating,
    lastPointerPosRef,
    moveSelectedTo,
    rotateAxisLock,
    rotateCurrentValueRef,
    rotateSelectedTo,
    rotateStartPointerRef,
    rotateStartValueRef,
    updateHoverCoords,
    viewerRef
  ])
}
