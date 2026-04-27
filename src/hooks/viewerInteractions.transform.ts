import { Plane, Raycaster, Vector2, Vector3 } from 'three'
import type { OffsetVector, Point3D, SelectedElement } from '../ifcViewerTypes'
import type { IfcViewerAPI } from '../viewer/IfcViewerAPICompat'

export type TransformAxis = 'x' | 'y' | 'z'
export type TransformAxisLock = TransformAxis | null

// This function clones a 3D point so transform state can be stored without sharing references.
export const clonePoint3D = (point: Point3D): Point3D => ({
  x: point.x,
  y: point.y,
  z: point.z
})

// This function clones an offset vector so drag state can be stored without sharing references.
export const cloneOffsetVector = (offset: OffsetVector): OffsetVector => ({
  dx: offset.dx,
  dy: offset.dy,
  dz: offset.dz
})

// This function checks whether a keyboard key is one of the supported transform axis locks.
export const isTransformAxisKey = (key: string): key is TransformAxis =>
  key === 'x' || key === 'y' || key === 'z'

// This function reports whether a rotation actually changed enough to be committed to history.
export const hasRotationChanged = (start: Point3D, current: Point3D, epsilon: number): boolean =>
  Math.abs(current.x - start.x) >= epsilon ||
  Math.abs(current.y - start.y) >= epsilon ||
  Math.abs(current.z - start.z) >= epsilon

// This function reports whether a drag actually changed the stored offset enough to be committed.
export const hasOffsetChanged = (start: OffsetVector, current: OffsetVector, epsilon = 1e-6): boolean =>
  Math.abs(current.dx - start.dx) >= epsilon ||
  Math.abs(current.dy - start.dy) >= epsilon ||
  Math.abs(current.dz - start.dz) >= epsilon

// This function computes the next rotation preview from pointer deltas and the active axis lock.
export const computeNextRotation = (
  startRotation: Point3D,
  deltaX: number,
  deltaY: number,
  axisLock: TransformAxisLock,
  sensitivity: number
): Point3D => {
  const nextRotation = clonePoint3D(startRotation)
  if (axisLock === 'x') {
    nextRotation.x += deltaY * sensitivity
  } else if (axisLock === 'y') {
    nextRotation.y += deltaX * sensitivity
  } else if (axisLock === 'z') {
    nextRotation.z += deltaX * sensitivity
  } else {
    nextRotation.x += deltaY * sensitivity
    nextRotation.y += deltaX * sensitivity
  }
  return nextRotation
}

// This function strips unwanted axes from a drag delta according to the active axis lock.
export const applyAxisLockToDragDelta = (
  delta: Vector3,
  axisLock: TransformAxisLock
): Vector3 => {
  const lockedDelta = delta.clone()
  if (axisLock === 'x') {
    lockedDelta.y = 0
    lockedDelta.z = 0
  } else if (axisLock === 'y') {
    lockedDelta.x = 0
    lockedDelta.z = 0
  } else if (axisLock === 'z') {
    lockedDelta.x = 0
    lockedDelta.y = 0
  }
  return lockedDelta
}

// This function converts a pointer position inside the container to normalized device coordinates.
export const getPointerNdc = (clientX: number, clientY: number, rect: DOMRect): Vector2 =>
  new Vector2(
    ((clientX - rect.left) / rect.width) * 2 - 1,
    -((clientY - rect.top) / rect.height) * 2 + 1
  )

// This function projects a pointer ray onto the provided drag plane.
export const intersectPointerWithPlane = (
  viewer: IfcViewerAPI,
  plane: Plane,
  clientX: number,
  clientY: number,
  rect: DOMRect
): Vector3 | null => {
  const ndc = getPointerNdc(clientX, clientY, rect)
  const raycaster = new Raycaster()
  raycaster.setFromCamera(ndc, viewer.context.getCamera())
  const hitPoint = new Vector3()
  const hit = raycaster.ray.intersectPlane(plane, hitPoint)
  return hit ? hitPoint : null
}

// This function builds the screen-space rotation anchor from the current pointer inside the viewer.
export const getRotationStartPointer = (
  container: HTMLDivElement | null,
  pointer: { x: number; y: number }
): { x: number; y: number } => {
  if (!container) {
    return { x: 0, y: 0 }
  }
  const rect = container.getBoundingClientRect()
  return {
    x: rect.left + pointer.x,
    y: rect.top + pointer.y
  }
}

// This function resolves the starting rotation used by the rotate mode when no stored delta exists yet.
export const getRotationStartValue = (
  selectedElement: SelectedElement,
  getIfcElementRotationDelta: (modelID: number, expressID: number) => Point3D | null
): Point3D =>
  getIfcElementRotationDelta(selectedElement.modelID, selectedElement.expressID) ?? {
    x: 0,
    y: 0,
    z: 0
  }

// This function creates the default drag plane aligned with the active camera view for free movement.
export const createViewDragSetup = (
  viewer: IfcViewerAPI,
  currentPos: Vector3,
  selectedElement: SelectedElement,
  customCubeModelId: number
): { plane: Plane; startPoint: Vector3 } => {
  const camera = viewer.context.getCamera()
  const normal = new Vector3()
  camera.getWorldDirection(normal)
  let startPoint = currentPos
  if (selectedElement.modelID !== customCubeModelId) {
    const hit = viewer.context.castRayIfc()
    if (hit?.point) {
      startPoint = hit.point
    }
  }
  return {
    plane: new Plane().setFromNormalAndCoplanarPoint(normal, startPoint),
    startPoint: startPoint.clone()
  }
}

// This function creates the horizontal drag plane used by the floor-move shortcut.
export const createFloorDragSetup = (
  viewer: IfcViewerAPI,
  currentPos: Vector3,
  container: HTMLDivElement | null,
  pointer: { x: number; y: number }
): { plane: Plane; startPoint: Vector3 } => {
  const plane = new Plane().setFromNormalAndCoplanarPoint(new Vector3(0, 1, 0), currentPos)
  let startPoint = currentPos.clone()
  if (container) {
    const rect = container.getBoundingClientRect()
    const hitPoint = intersectPointerWithPlane(viewer, plane, rect.left + pointer.x, rect.top + pointer.y, rect)
    if (hitPoint) {
      startPoint = hitPoint
    }
  }
  return { plane, startPoint }
}

// This function identifies whether a keyboard event target should keep text input focus instead of triggering shortcuts.
export const isEditableEventTarget = (target: EventTarget | null): boolean => {
  const element = target as HTMLElement | null
  if (!element) return false
  const tagName = element.tagName
  return element.isContentEditable || tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT'
}
