import CameraControls from 'camera-controls'
import { Vector3 } from 'three'
import type { Point3D } from '../ifcViewerTypes'
import type { IfcViewerAPI } from '../viewer/IfcViewerAPICompat'
import {
  FREE_WHEEL_MAX_DELTA,
  FREE_WHEEL_MOVE_FACTOR,
  WALK_LOOK_SENSITIVITY,
  WALK_PITCH_LIMIT
} from '../ifcViewer.constants'

export type NavigationMode = 'free' | 'walk'
export type WalkMoveKey = 'arrowup' | 'arrowleft' | 'arrowdown' | 'arrowright'

export const emptyWalkKeyState: Record<WalkMoveKey, boolean> = {
  arrowup: false,
  arrowleft: false,
  arrowdown: false,
  arrowright: false
}

type CameraControlsFacade = {
  getPosition?: (out: Vector3) => void
  getTarget?: (out: Vector3) => void
  setPosition?: (x: number, y: number, z: number, enableTransition?: boolean) => void
  setTarget?: (x: number, y: number, z: number, enableTransition?: boolean) => void
  setLookAt?: (
    positionX: number,
    positionY: number,
    positionZ: number,
    targetX: number,
    targetY: number,
    targetZ: number,
    enableTransition?: boolean
  ) => void
  mouseButtons: {
    left: number
    middle: number
    right: number
    wheel: number
  }
}

// Maps a keyboard event to one of the supported walk movement directions.
export const getWalkMoveKey = (event: KeyboardEvent): WalkMoveKey | null => {
  const key = event.key.toLowerCase()
  if (key === 'arrowup' || key === 'up' || event.code === 'ArrowUp') return 'arrowup'
  if (key === 'arrowleft' || key === 'left' || event.code === 'ArrowLeft') return 'arrowleft'
  if (key === 'arrowdown' || key === 'down' || event.code === 'ArrowDown') return 'arrowdown'
  if (key === 'arrowright' || key === 'right' || event.code === 'ArrowRight') return 'arrowright'
  return null
}

// Returns the camera-controls facade used by the interaction helpers when it is available.
const getViewerCameraControls = (viewer: IfcViewerAPI | null | undefined): CameraControlsFacade | null => {
  return (viewer?.context?.ifcCamera?.cameraControls as CameraControlsFacade | undefined) ?? null
}

// Captures the current camera position and target from the viewer controls when available.
export const captureViewerCameraState = (
  viewer: IfcViewerAPI | null | undefined
): { cameraPosition: Point3D; cameraTarget: Point3D } | null => {
  const controls = getViewerCameraControls(viewer)
  if (!controls?.getPosition || !controls?.getTarget) return null

  const position = new Vector3()
  const target = new Vector3()
  controls.getPosition(position)
  controls.getTarget(target)

  return {
    cameraPosition: { x: position.x, y: position.y, z: position.z },
    cameraTarget: { x: target.x, y: target.y, z: target.z }
  }
}

// Applies one instant look-at update when the controls support the combined setter.
const setLookAtInstant = (
  controls: CameraControlsFacade,
  position: Vector3,
  target: Vector3
): boolean => {
  if (typeof controls.setLookAt !== 'function') return false
  controls.setLookAt(position.x, position.y, position.z, target.x, target.y, target.z, false)
  return true
}

// Restores one previously captured camera position and target back into the viewer controls.
export const restoreViewerCameraState = (
  viewer: IfcViewerAPI | null | undefined,
  cameraPosition: Point3D | null | undefined,
  cameraTarget: Point3D | null | undefined
): boolean => {
  if (!cameraPosition || !cameraTarget) return false
  const controls = getViewerCameraControls(viewer)
  if (!controls) return false

  return setLookAtInstant(
    controls,
    new Vector3(cameraPosition.x, cameraPosition.y, cameraPosition.z),
    new Vector3(cameraTarget.x, cameraTarget.y, cameraTarget.z)
  )
}

// Switches camera-controls mouse bindings between free and walk navigation modes.
export const applyNavigationControls = (viewer: IfcViewerAPI, mode: NavigationMode) => {
  const controls = getViewerCameraControls(viewer)
  if (!controls) return

  if (mode === 'walk') {
    controls.mouseButtons.left = CameraControls.ACTION.NONE
    controls.mouseButtons.middle = CameraControls.ACTION.NONE
    controls.mouseButtons.right = CameraControls.ACTION.NONE
    controls.mouseButtons.wheel = CameraControls.ACTION.NONE
    return
  }

  controls.mouseButtons.left = CameraControls.ACTION.NONE
  controls.mouseButtons.middle = CameraControls.ACTION.ROTATE
  controls.mouseButtons.right = CameraControls.ACTION.TRUCK
  controls.mouseButtons.wheel = CameraControls.ACTION.NONE
}

// Rotates the walk camera around its current position while keeping the cached flat heading in sync.
export const updateWalkLookByDelta = (
  viewer: IfcViewerAPI | null | undefined,
  walkHeading: Vector3,
  deltaX: number,
  deltaY: number
): boolean => {
  const controls = getViewerCameraControls(viewer)
  if (!controls?.getPosition || !controls?.getTarget || !controls?.setLookAt) return false

  const position = new Vector3()
  const target = new Vector3()
  controls.getPosition(position)
  controls.getTarget(target)

  const direction = target.sub(position)
  if (direction.lengthSq() <= 1e-8) {
    direction.copy(walkHeading)
    if (direction.lengthSq() <= 1e-8) {
      direction.set(0, 0, -1)
    }
  }
  direction.normalize()

  const currentPitch = Math.asin(Math.max(-1, Math.min(1, direction.y)))
  const currentYaw = Math.atan2(direction.x, direction.z)
  const nextYaw = currentYaw - deltaX * WALK_LOOK_SENSITIVITY
  const nextPitch = Math.max(
    -WALK_PITCH_LIMIT,
    Math.min(WALK_PITCH_LIMIT, currentPitch - deltaY * WALK_LOOK_SENSITIVITY)
  )
  const cosPitch = Math.cos(nextPitch)
  const nextDirection = new Vector3(
    Math.sin(nextYaw) * cosPitch,
    Math.sin(nextPitch),
    Math.cos(nextYaw) * cosPitch
  ).normalize()

  const horizontalDirection = new Vector3(nextDirection.x, 0, nextDirection.z)
  if (horizontalDirection.lengthSq() > 1e-8) {
    horizontalDirection.normalize()
    walkHeading.copy(horizontalDirection)
  }

  const nextTarget = position.clone().add(nextDirection)
  controls.setLookAt(
    position.x,
    position.y,
    position.z,
    nextTarget.x,
    nextTarget.y,
    nextTarget.z,
    false
  )
  return true
}

// Translates the camera and target by the same offset so the current view direction is preserved.
export const teleportCameraToPoint = (
  viewer: IfcViewerAPI | null | undefined,
  point: Point3D | null
): boolean => {
  if (!point) return false
  const controls = getViewerCameraControls(viewer)
  if (!controls?.getPosition || !controls?.getTarget) return false

  const currentPosition = new Vector3()
  const currentTarget = new Vector3()
  controls.getPosition(currentPosition)
  controls.getTarget(currentTarget)

  const nextTarget = new Vector3(point.x, point.y, point.z)
  const translation = nextTarget.clone().sub(currentTarget)
  currentPosition.add(translation)

  return setLookAtInstant(controls, currentPosition, nextTarget)
}

// Repositions the camera to a point while preserving the current viewing direction when possible.
export const moveCameraToPoint = (
  viewer: IfcViewerAPI | null | undefined,
  point: Point3D | null
): boolean => {
  if (!point) return false
  const controls = getViewerCameraControls(viewer)
  if (!controls) return false

  if (typeof controls.getPosition === 'function' && typeof controls.getTarget === 'function') {
    const currentPosition = new Vector3()
    const currentTarget = new Vector3()
    controls.getPosition(currentPosition)
    controls.getTarget(currentTarget)

    const viewDirection = currentTarget.sub(currentPosition)
    if (viewDirection.lengthSq() <= 1e-8) {
      viewDirection.set(0, 0, -1)
    }

    const nextPosition = new Vector3(point.x, point.y, point.z)
    const nextTarget = nextPosition.clone().add(viewDirection)

    if (setLookAtInstant(controls, nextPosition, nextTarget)) {
      return true
    }

    if (typeof controls.setPosition === 'function' && typeof controls.setTarget === 'function') {
      controls.setPosition(nextPosition.x, nextPosition.y, nextPosition.z, false)
      controls.setTarget(nextTarget.x, nextTarget.y, nextTarget.z, false)
      return true
    }
  }

  if (typeof controls.setPosition === 'function' && typeof controls.setTarget === 'function') {
    controls.setPosition(point.x, point.y, point.z, false)
    controls.setTarget(point.x, point.y, point.z - 1, false)
    return true
  }

  return setLookAtInstant(
    controls,
    new Vector3(point.x, point.y, point.z),
    new Vector3(point.x, point.y, point.z - 1)
  )
}

// Moves the free camera forward or backward along its current view vector using wheel delta.
export const moveCameraAlongView = (
  viewer: IfcViewerAPI | null | undefined,
  rawWheelDelta: number
): boolean => {
  const controls = getViewerCameraControls(viewer)
  if (!controls?.getPosition || !controls?.getTarget) return false

  const wheelDelta = Math.max(-FREE_WHEEL_MAX_DELTA, Math.min(FREE_WHEEL_MAX_DELTA, rawWheelDelta))
  if (Math.abs(wheelDelta) < 1e-6) return false

  const position = new Vector3()
  const target = new Vector3()
  controls.getPosition(position)
  controls.getTarget(target)

  const direction = target.clone().sub(position)
  if (direction.lengthSq() <= 1e-8) return false
  direction.normalize()

  const move = direction.multiplyScalar(-wheelDelta * FREE_WHEEL_MOVE_FACTOR)
  const nextPosition = position.clone().add(move)
  const nextTarget = target.clone().add(move)

  if (setLookAtInstant(controls, nextPosition, nextTarget)) {
    return true
  }

  if (typeof controls.setPosition === 'function' && typeof controls.setTarget === 'function') {
    controls.setPosition(nextPosition.x, nextPosition.y, nextPosition.z, false)
    controls.setTarget(nextTarget.x, nextTarget.y, nextTarget.z, false)
    return true
  }

  return false
}
