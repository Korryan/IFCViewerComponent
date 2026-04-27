import { useEffect } from 'react'
import type { MutableRefObject } from 'react'
import { Vector3 } from 'three'
import { WALK_MOVE_SPEED } from '../ifcViewer.constants'
import type { IfcViewerAPI } from '../viewer/IfcViewerAPICompat'
import type { WalkMoveKey } from './viewerInteractions.camera'
import {
  getWalkCameraControls,
  syncWalkHeading,
  type WalkControlRefs,
  type WalkOverlaySetter
} from './viewerWalkControls.shared'

type UseViewerWalkMovementLoopArgs = {
  isWalkMode: boolean
  refs: WalkControlRefs
  setWalkOverlaySuppressed: WalkOverlaySetter
  stopWalkMovementLoop: () => void
  viewerRef: MutableRefObject<IfcViewerAPI | null>
}

// This function converts the pressed walk keys into forward and strafe movement intent.
const readWalkMoveInputs = (keys: Record<WalkMoveKey, boolean>) => ({
  forwardInput: (keys.arrowup ? 1 : 0) - (keys.arrowdown ? 1 : 0),
  strafeInput: (keys.arrowright ? 1 : 0) - (keys.arrowleft ? 1 : 0)
})

// This hook advances the walk-mode animation loop and translates the camera from pressed movement keys.
export const useViewerWalkMovementLoop = ({
  isWalkMode,
  refs,
  setWalkOverlaySuppressed,
  stopWalkMovementLoop,
  viewerRef
}: UseViewerWalkMovementLoopArgs): void => {
  useEffect(() => {
    if (!isWalkMode) return

    const up = new Vector3(0, 1, 0)
    const position = new Vector3()
    const target = new Vector3()
    const move = new Vector3()

    // This function advances one walk frame and applies the current movement intent to the camera.
    const tick = (timestamp: number) => {
      const controls = getWalkCameraControls(viewerRef.current)
      if (!controls) {
        refs.walkFrameRef.current = requestAnimationFrame(tick)
        return
      }

      const lastTimestamp = refs.walkLastTimestampRef.current ?? timestamp
      refs.walkLastTimestampRef.current = timestamp
      const deltaTime = Math.min((timestamp - lastTimestamp) / 1000, 0.05)

      const { forwardInput, strafeInput } = readWalkMoveInputs(refs.walkKeyStateRef.current)
      const isMoving = forwardInput !== 0 || strafeInput !== 0

      if (refs.walkMoveActiveRef.current !== isMoving) {
        refs.walkMoveActiveRef.current = isMoving
        setWalkOverlaySuppressed(
          isMoving || refs.walkDragActiveRef.current || refs.walkLookActiveRef.current
        )
      }

      if (deltaTime > 0 && isMoving && controls.getPosition && controls.getTarget && controls.setLookAt) {
        controls.getPosition(position)
        controls.getTarget(target)
        const forward = syncWalkHeading(target, position, refs.walkHeadingRef)
        const right = new Vector3().crossVectors(forward, up).normalize()

        move.set(0, 0, 0)
        move.addScaledVector(forward, forwardInput)
        move.addScaledVector(right, strafeInput)
        if (move.lengthSq() > 1e-8) {
          move.normalize().multiplyScalar(WALK_MOVE_SPEED * deltaTime)
          position.add(move)
          target.add(move)
          controls.setLookAt(position.x, position.y, position.z, target.x, target.y, target.z, false)
        }
      }

      refs.walkFrameRef.current = requestAnimationFrame(tick)
    }

    refs.walkFrameRef.current = requestAnimationFrame(tick)
    return () => {
      stopWalkMovementLoop()
    }
  }, [isWalkMode, refs, setWalkOverlaySuppressed, stopWalkMovementLoop, viewerRef])
}
