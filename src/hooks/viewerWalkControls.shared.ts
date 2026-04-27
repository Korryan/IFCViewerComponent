import type { MutableRefObject } from 'react'
import { Vector3 } from 'three'
import { WALK_DRAG_MOVE_PER_PIXEL } from '../ifcViewer.constants'
import type { IfcViewerAPI } from '../viewer/IfcViewerAPICompat'
import type { WalkMoveKey } from './viewerInteractions.camera'

export type WalkCameraControls = {
  getPosition?: (out: Vector3) => void
  getTarget?: (out: Vector3) => void
  setLookAt?: (
    positionX: number,
    positionY: number,
    positionZ: number,
    targetX: number,
    targetY: number,
    targetZ: number,
    enableTransition?: boolean
  ) => void
}

export type WalkOverlaySetter = (suppressed: boolean) => void

export type WalkControlRefs = {
  walkKeyStateRef: MutableRefObject<Record<WalkMoveKey, boolean>>
  walkHeadingRef: MutableRefObject<Vector3>
  walkFrameRef: MutableRefObject<number | null>
  walkLastTimestampRef: MutableRefObject<number | null>
  walkMoveActiveRef: MutableRefObject<boolean>
  walkLookActiveRef: MutableRefObject<boolean>
  walkLookPointerIdRef: MutableRefObject<number | null>
  walkLookLastPointerRef: MutableRefObject<{ x: number; y: number } | null>
  walkDragActiveRef: MutableRefObject<boolean>
  walkDragPointerIdRef: MutableRefObject<number | null>
  walkDragLastPointerRef: MutableRefObject<{ x: number; y: number } | null>
}

// This function absorbs optional walk overlay updates when no caller needs them.
export const noopWalkOverlaySuppressed: WalkOverlaySetter = (_suppressed) => {}

// This function returns the camera controls only when the required walk movement methods are available.
export const getWalkCameraControls = (viewer: IfcViewerAPI | null): WalkCameraControls | null => {
  const controls = viewer?.context?.ifcCamera?.cameraControls as WalkCameraControls | undefined
  if (!controls?.getPosition || !controls?.getTarget || !controls?.setLookAt) {
    return null
  }
  return controls
}

// This function keeps the stored flat walk heading aligned with the current camera direction when possible.
export const syncWalkHeading = (
  target: Vector3,
  position: Vector3,
  headingRef: MutableRefObject<Vector3>
): Vector3 => {
  const forward = new Vector3().subVectors(target, position)
  forward.y = 0
  if (forward.lengthSq() > 1e-8) {
    forward.normalize()
    headingRef.current.copy(forward)
  } else {
    forward.copy(headingRef.current)
  }
  return forward
}

// This function applies right-mouse walk panning relative to the current flat camera heading.
export const applyWalkDragMove = (
  controls: WalkCameraControls,
  headingRef: MutableRefObject<Vector3>,
  deltaX: number,
  deltaY: number
): void => {
  if (!controls.getPosition || !controls.getTarget || !controls.setLookAt) return

  const position = new Vector3()
  const target = new Vector3()
  const up = new Vector3(0, 1, 0)
  controls.getPosition(position)
  controls.getTarget(target)

  const forward = syncWalkHeading(target, position, headingRef)
  const right = new Vector3().crossVectors(forward, up).normalize()
  const move = new Vector3()
  move.addScaledVector(right, deltaX * WALK_DRAG_MOVE_PER_PIXEL)
  move.addScaledVector(forward, -deltaY * WALK_DRAG_MOVE_PER_PIXEL)
  position.add(move)
  target.add(move)

  controls.setLookAt(position.x, position.y, position.z, target.x, target.y, target.z, false)
}

// This function attempts to capture a pointer on the walk container without failing unsupported platforms.
export const captureWalkPointer = (container: HTMLDivElement, pointerId: number): void => {
  try {
    container.setPointerCapture(pointerId)
  } catch {
    // Ignore capture errors for unsupported platforms.
  }
}

// This function attempts to release a captured pointer on the walk container without failing unsupported platforms.
export const releaseWalkPointer = (container: HTMLDivElement, pointerId: number | null): void => {
  if (pointerId === null) return
  try {
    container.releasePointerCapture(pointerId)
  } catch {
    // Ignore release errors for unsupported platforms.
  }
}
