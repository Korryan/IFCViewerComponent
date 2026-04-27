import { useCallback, useMemo, useRef } from 'react'
import type { MutableRefObject } from 'react'
import { Vector3 } from 'three'
import type { IfcViewerAPI } from '../viewer/IfcViewerAPICompat'
import {
  emptyWalkKeyState,
  type WalkMoveKey
} from './viewerInteractions.camera'
import { useViewerWalkMovementLoop } from './useViewerWalkMovementLoop'
import { useViewerWalkPointerGestures } from './useViewerWalkPointerGestures'
import { noopWalkOverlaySuppressed } from './viewerWalkControls.shared'

type UseViewerWalkControlsArgs = {
  containerRef: MutableRefObject<HTMLDivElement | null>
  isWalkMode: boolean
  setWalkOverlaySuppressed?: (suppressed: boolean) => void
  viewerRef: MutableRefObject<IfcViewerAPI | null>
}

type UseViewerWalkControlsResult = {
  stopWalkMovementLoop: () => void
  walkKeyStateRef: MutableRefObject<Record<WalkMoveKey, boolean>>
}

// This hook owns walk-mode movement, pointer look, and pointer drag state for the viewer.
export const useViewerWalkControls = ({
  containerRef,
  isWalkMode,
  setWalkOverlaySuppressed = noopWalkOverlaySuppressed,
  viewerRef
}: UseViewerWalkControlsArgs): UseViewerWalkControlsResult => {
  const walkKeyStateRef = useRef<Record<WalkMoveKey, boolean>>({ ...emptyWalkKeyState })
  const walkHeadingRef = useRef<Vector3>(new Vector3(0, 0, -1))
  const walkFrameRef = useRef<number | null>(null)
  const walkLastTimestampRef = useRef<number | null>(null)
  const walkMoveActiveRef = useRef(false)
  const walkLookActiveRef = useRef(false)
  const walkLookPointerIdRef = useRef<number | null>(null)
  const walkLookLastPointerRef = useRef<{ x: number; y: number } | null>(null)
  const walkDragActiveRef = useRef(false)
  const walkDragPointerIdRef = useRef<number | null>(null)
  const walkDragLastPointerRef = useRef<{ x: number; y: number } | null>(null)
  // This memoizes the walk ref bundle so nested gesture hooks do not rebind listeners on every parent render.
  const walkRefs = useMemo(
    () => ({
      walkKeyStateRef,
      walkHeadingRef,
      walkFrameRef,
      walkLastTimestampRef,
      walkMoveActiveRef,
      walkLookActiveRef,
      walkLookPointerIdRef,
      walkLookLastPointerRef,
      walkDragActiveRef,
      walkDragPointerIdRef,
      walkDragLastPointerRef
    }),
    []
  )

  // This function fully resets walk-mode animation and pointer state when walk mode stops or unmounts.
  const stopWalkMovementLoop = useCallback(() => {
    if (walkFrameRef.current !== null) {
      cancelAnimationFrame(walkFrameRef.current)
      walkFrameRef.current = null
    }
    walkLastTimestampRef.current = null
    walkKeyStateRef.current = { ...emptyWalkKeyState }
    walkHeadingRef.current.set(0, 0, -1)
    walkMoveActiveRef.current = false
    walkLookActiveRef.current = false
    walkLookPointerIdRef.current = null
    walkLookLastPointerRef.current = null
    walkDragActiveRef.current = false
    walkDragPointerIdRef.current = null
    walkDragLastPointerRef.current = null
    setWalkOverlaySuppressed(false)
  }, [setWalkOverlaySuppressed])

  useViewerWalkMovementLoop({
    isWalkMode,
    refs: walkRefs,
    setWalkOverlaySuppressed,
    stopWalkMovementLoop,
    viewerRef
  })

  useViewerWalkPointerGestures({
    containerRef,
    isWalkMode,
    refs: walkRefs,
    setWalkOverlaySuppressed,
    viewerRef
  })

  return {
    stopWalkMovementLoop,
    walkKeyStateRef
  }
}
