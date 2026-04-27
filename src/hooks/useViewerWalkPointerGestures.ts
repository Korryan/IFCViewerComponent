import { useEffect } from 'react'
import type { MutableRefObject } from 'react'
import type { IfcViewerAPI } from '../viewer/IfcViewerAPICompat'
import { updateWalkLookByDelta as updateWalkLookByDeltaInternal } from './viewerInteractions.camera'
import {
  applyWalkDragMove,
  captureWalkPointer,
  getWalkCameraControls,
  releaseWalkPointer,
  type WalkControlRefs,
  type WalkOverlaySetter
} from './viewerWalkControls.shared'

type UseViewerWalkPointerGesturesArgs = {
  containerRef: MutableRefObject<HTMLDivElement | null>
  isWalkMode: boolean
  refs: WalkControlRefs
  setWalkOverlaySuppressed: WalkOverlaySetter
  viewerRef: MutableRefObject<IfcViewerAPI | null>
}

// This hook owns walk-mode pointer look, pointer drag, and context-menu suppression on the viewer canvas.
export const useViewerWalkPointerGestures = ({
  containerRef,
  isWalkMode,
  refs,
  setWalkOverlaySuppressed,
  viewerRef
}: UseViewerWalkPointerGesturesArgs): void => {
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    // This function starts middle-button look or right-button drag and captures the active pointer.
    const handlePointerDown = (event: PointerEvent) => {
      if (!isWalkMode) return
      if (event.button === 1) {
        refs.walkLookActiveRef.current = true
        refs.walkLookPointerIdRef.current = event.pointerId
        refs.walkLookLastPointerRef.current = { x: event.clientX, y: event.clientY }
      } else if (event.button === 2) {
        refs.walkDragActiveRef.current = true
        refs.walkDragPointerIdRef.current = event.pointerId
        refs.walkDragLastPointerRef.current = { x: event.clientX, y: event.clientY }
      } else {
        return
      }
      setWalkOverlaySuppressed(true)
      captureWalkPointer(container, event.pointerId)
      event.preventDefault()
    }

    // This function updates the active walk look or drag gesture from pointer movement deltas.
    const handlePointerMove = (event: PointerEvent) => {
      if (!isWalkMode) return

      const isLookPointer =
        refs.walkLookActiveRef.current &&
        (refs.walkLookPointerIdRef.current === null || event.pointerId === refs.walkLookPointerIdRef.current)
      if (isLookPointer) {
        const lastPointer = refs.walkLookLastPointerRef.current
        refs.walkLookLastPointerRef.current = { x: event.clientX, y: event.clientY }
        if (!lastPointer) return
        const deltaX = event.clientX - lastPointer.x
        const deltaY = event.clientY - lastPointer.y
        if (deltaX === 0 && deltaY === 0) return
        updateWalkLookByDeltaInternal(viewerRef.current, refs.walkHeadingRef.current, deltaX, deltaY)
        event.preventDefault()
        return
      }

      const isDragPointer =
        refs.walkDragActiveRef.current &&
        (refs.walkDragPointerIdRef.current === null || event.pointerId === refs.walkDragPointerIdRef.current)
      if (!isDragPointer) return

      const lastPointer = refs.walkDragLastPointerRef.current
      refs.walkDragLastPointerRef.current = { x: event.clientX, y: event.clientY }
      if (!lastPointer) return

      const deltaX = event.clientX - lastPointer.x
      const deltaY = event.clientY - lastPointer.y
      if (deltaX === 0 && deltaY === 0) return

      const controls = getWalkCameraControls(viewerRef.current)
      if (!controls) return
      applyWalkDragMove(controls, refs.walkHeadingRef, deltaX, deltaY)
      event.preventDefault()
    }

    // This function stops the active middle-button look gesture and releases its pointer capture.
    const stopLook = (event?: PointerEvent) => {
      if (event && event.button !== 1) return
      if (
        event &&
        refs.walkLookPointerIdRef.current !== null &&
        event.pointerId !== refs.walkLookPointerIdRef.current
      ) {
        return
      }
      const pointerId = refs.walkLookPointerIdRef.current
      refs.walkLookActiveRef.current = false
      refs.walkLookPointerIdRef.current = null
      refs.walkLookLastPointerRef.current = null
      setWalkOverlaySuppressed(refs.walkMoveActiveRef.current || refs.walkDragActiveRef.current)
      releaseWalkPointer(container, pointerId)
    }

    // This function stops the active right-button drag gesture and releases its pointer capture.
    const stopDragMove = (event?: PointerEvent) => {
      if (event && event.button !== 2) return
      if (
        event &&
        refs.walkDragPointerIdRef.current !== null &&
        event.pointerId !== refs.walkDragPointerIdRef.current
      ) {
        return
      }
      const pointerId = refs.walkDragPointerIdRef.current
      refs.walkDragActiveRef.current = false
      refs.walkDragPointerIdRef.current = null
      refs.walkDragLastPointerRef.current = null
      setWalkOverlaySuppressed(refs.walkMoveActiveRef.current || refs.walkLookActiveRef.current)
      releaseWalkPointer(container, pointerId)
    }

    // This function suppresses the browser context menu while walk-mode drag gestures are active.
    const handleContextMenu = (event: MouseEvent) => {
      if (!isWalkMode) return
      event.preventDefault()
    }

    // This function clears any active walk gesture when the browser window loses focus.
    const handleWindowBlur = () => {
      stopLook()
      stopDragMove()
    }

    container.addEventListener('pointerdown', handlePointerDown)
    container.addEventListener('pointermove', handlePointerMove)
    container.addEventListener('contextmenu', handleContextMenu)
    window.addEventListener('pointerup', stopLook)
    window.addEventListener('pointerup', stopDragMove)
    window.addEventListener('blur', handleWindowBlur)
    return () => {
      container.removeEventListener('pointerdown', handlePointerDown)
      container.removeEventListener('pointermove', handlePointerMove)
      container.removeEventListener('contextmenu', handleContextMenu)
      window.removeEventListener('pointerup', stopLook)
      window.removeEventListener('pointerup', stopDragMove)
      window.removeEventListener('blur', handleWindowBlur)
      stopLook()
      stopDragMove()
    }
  }, [containerRef, isWalkMode, refs, setWalkOverlaySuppressed, viewerRef])
}
