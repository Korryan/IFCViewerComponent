import type { Dispatch, MutableRefObject, SetStateAction } from 'react'
import { Euler, Matrix4, Mesh, Quaternion, Vector3 } from 'three'
import type { OffsetVector, Point3D, SelectedElement } from '../ifcViewerTypes'
import type { IfcViewerAPI } from '../viewer/IfcViewerAPICompat'
import { COORD_EPSILON, CUSTOM_CUBE_MODEL_ID, normalizeOffsetVector } from './selectionOffsets.shared'
import { MOVED_SUBSET_PREFIX, removeMovedSubset } from './selectionOffsets.subsets'

type SetState<T> = Dispatch<SetStateAction<T>>

// Normalizes a rotation triple so each axis is always a finite number.
export const normalizeRotation = (rotation: Point3D | null | undefined): Point3D => ({
  x: Number.isFinite(rotation?.x) ? Number(rotation?.x) : 0,
  y: Number.isFinite(rotation?.y) ? Number(rotation?.y) : 0,
  z: Number.isFinite(rotation?.z) ? Number(rotation?.z) : 0
})

// Reports whether a rotation is effectively zero within the editor epsilon.
export const isZeroRotation = (rotation: Point3D | null | undefined) => {
  if (!rotation) return true
  return (
    Math.abs(rotation.x) < COORD_EPSILON &&
    Math.abs(rotation.y) < COORD_EPSILON &&
    Math.abs(rotation.z) < COORD_EPSILON
  )
}

// Rebuilds one moved IFC subset so the selected element lands at the requested offset and rotation.
export const applyIfcElementTransform = (args: {
  viewer: IfcViewerAPI
  modelID: number
  expressID: number
  targetOffset: OffsetVector
  targetRotation?: Point3D | null
  ensureBaseSubset: (modelID: number) => Mesh | null
  getBaseCenter: (modelID: number, expressID: number) => Point3D | null
  getElementKey: (modelID: number, expressID: number) => string
  hasRenderableExpressId: (modelID: number, expressID: number) => boolean
  elementOffsetsRef: MutableRefObject<Map<string, OffsetVector>>
  elementRotationsRef: MutableRefObject<Map<string, Point3D>>
  movedSubsetsRef: MutableRefObject<Map<string, Mesh>>
  filterIdsRef: MutableRefObject<Map<number, Set<number> | null>>
  highlightedIfcRef: MutableRefObject<{ modelID: number; expressID: number } | null>
  registerPickable: (viewer: IfcViewerAPI, mesh: Mesh, modelID?: number) => void
  removePickable: (viewer: IfcViewerAPI, mesh: Mesh) => void
  updateVisibilityForModel: (modelID: number, allowedIds: Set<number> | null) => void
  applyIfcSelectionHighlight: (modelID: number, expressID: number) => void
}) => {
  if (!args.hasRenderableExpressId(args.modelID, args.expressID)) {
    return
  }

  const manager = args.viewer.IFC.loader.ifcManager
  const scene = args.viewer.context.getScene()
  const key = args.getElementKey(args.modelID, args.expressID)
  const baseSubset = args.ensureBaseSubset(args.modelID)
  if (!baseSubset) {
    return
  }

  const baseCenter = args.getBaseCenter(args.modelID, args.expressID)
  if (!baseCenter) {
    return
  }

  const resolvedRotation = normalizeRotation(
    args.targetRotation ?? args.elementRotationsRef.current.get(key)
  )

  removeMovedSubset({
    modelID: args.modelID,
    key,
    movedSubset: args.movedSubsetsRef.current.get(key),
    scene,
    manager,
    removePickable: (mesh) => args.removePickable(args.viewer, mesh)
  })
  args.movedSubsetsRef.current.delete(key)

  const isZeroOffset =
    Math.abs(args.targetOffset.dx - baseCenter.x) < COORD_EPSILON &&
    Math.abs(args.targetOffset.dy - baseCenter.y) < COORD_EPSILON &&
    Math.abs(args.targetOffset.dz - baseCenter.z) < COORD_EPSILON
  const hasRotation = !isZeroRotation(resolvedRotation)

  if (isZeroOffset && !hasRotation) {
    args.elementOffsetsRef.current.delete(key)
    args.elementRotationsRef.current.delete(key)
    const activeFilter = args.filterIdsRef.current.get(args.modelID) ?? null
    args.updateVisibilityForModel(args.modelID, activeFilter)
    const activeHighlight = args.highlightedIfcRef.current
    if (
      activeHighlight &&
      activeHighlight.modelID === args.modelID &&
      activeHighlight.expressID === args.expressID
    ) {
      args.applyIfcSelectionHighlight(args.modelID, args.expressID)
    }
    return
  }

  const moved = manager.createSubset({
    modelID: args.modelID,
    ids: [args.expressID],
    scene,
    removePrevious: true,
    customID: `${MOVED_SUBSET_PREFIX}${key}`
  }) as Mesh | null

  if (!moved) {
    return
  }

  const baseMatrix = new Matrix4()
  if (baseSubset) {
    baseMatrix.copy(baseSubset.matrix)
  } else {
    const modelMesh = manager.state?.models?.[args.modelID]?.mesh as Mesh | undefined
    if (modelMesh) {
      baseMatrix.copy(modelMesh.matrix)
    } else {
      baseMatrix.identity()
    }
  }

  const baseQuaternion = new Quaternion()
  const baseScale = new Vector3(1, 1, 1)
  baseMatrix.decompose(new Vector3(), baseQuaternion, baseScale)

  const baseInverse = new Matrix4().copy(baseMatrix).invert()
  const localPivot = new Vector3(baseCenter.x, baseCenter.y, baseCenter.z).applyMatrix4(baseInverse)

  const deltaQuat = new Quaternion().setFromEuler(
    new Euler(resolvedRotation.x, resolvedRotation.y, resolvedRotation.z, 'XYZ')
  )
  const worldQuaternion = deltaQuat.clone().multiply(baseQuaternion)
  const pivotOffset = localPivot.clone().multiply(baseScale).applyQuaternion(worldQuaternion)
  const targetCenter = new Vector3(args.targetOffset.dx, args.targetOffset.dy, args.targetOffset.dz)
  const resolvedPosition = targetCenter.clone().sub(pivotOffset)

  moved.quaternion.copy(worldQuaternion)
  moved.scale.copy(baseScale)
  moved.position.copy(resolvedPosition)
  moved.updateMatrix()
  moved.matrixAutoUpdate = false

  args.movedSubsetsRef.current.set(key, moved)
  args.elementOffsetsRef.current.set(key, args.targetOffset)
  if (hasRotation) {
    args.elementRotationsRef.current.set(key, resolvedRotation)
  } else {
    args.elementRotationsRef.current.delete(key)
  }
  args.registerPickable(args.viewer, moved)
  const activeFilter = args.filterIdsRef.current.get(args.modelID) ?? null
  args.updateVisibilityForModel(args.modelID, activeFilter)
  const activeHighlight = args.highlightedIfcRef.current
  if (
    activeHighlight &&
    activeHighlight.modelID === args.modelID &&
    activeHighlight.expressID === args.expressID
  ) {
    args.applyIfcSelectionHighlight(args.modelID, args.expressID)
  }
}

// Moves the currently selected element either by updating a custom object directly or rebuilding its IFC moved subset.
export const moveSelectedElement = (args: {
  viewer: IfcViewerAPI
  selectedElement: SelectedElement | null
  targetOffset: OffsetVector
  setOffsetInputs: SetState<OffsetVector>
  focusOffsetRef: MutableRefObject<Point3D | null>
  cubeRegistryRef: MutableRefObject<Map<number, Mesh>>
  elementOffsetsRef: MutableRefObject<Map<string, OffsetVector>>
  applyIfcElementOffset: (modelID: number, expressID: number, targetOffset: OffsetVector) => void
}) => {
  if (!args.selectedElement) return

  const normalizedTarget = normalizeOffsetVector(args.targetOffset)
  args.setOffsetInputs(normalizedTarget)

  if (args.selectedElement.modelID === CUSTOM_CUBE_MODEL_ID) {
    args.focusOffsetRef.current = null
    const key = `cube:${args.selectedElement.expressID}`
    const customObject = args.cubeRegistryRef.current.get(args.selectedElement.expressID)
    if (customObject) {
      customObject.position.set(normalizedTarget.dx, normalizedTarget.dy, normalizedTarget.dz)
      customObject.updateMatrix()
      customObject.matrixAutoUpdate = false
      args.elementOffsetsRef.current.set(key, normalizedTarget)
    }
    return
  }

  const focusOffset = args.focusOffsetRef.current
  const adjustedTarget = focusOffset
    ? {
        dx: normalizedTarget.dx - focusOffset.x,
        dy: normalizedTarget.dy - focusOffset.y,
        dz: normalizedTarget.dz - focusOffset.z
      }
    : normalizedTarget

  args.applyIfcElementOffset(
    args.selectedElement.modelID,
    args.selectedElement.expressID,
    adjustedTarget
  )
}

// Rotates the current selection either by mutating a custom object directly or rebuilding its IFC moved subset.
export const rotateSelectedElement = (args: {
  viewer: IfcViewerAPI
  selectedElement: SelectedElement | null
  targetRotation: Point3D
  cubeRegistryRef: MutableRefObject<Map<number, Mesh>>
  getElementWorldPosition: (modelID: number, expressID: number) => Point3D | null
  getBaseCenter: (modelID: number, expressID: number) => Point3D | null
  applyIfcElementTransform: (
    modelID: number,
    expressID: number,
    targetOffset: OffsetVector,
    targetRotation?: Point3D | null
  ) => void
}) => {
  if (!args.selectedElement) return
  const normalized = normalizeRotation(args.targetRotation)

  if (args.selectedElement.modelID === CUSTOM_CUBE_MODEL_ID) {
    const customObject = args.cubeRegistryRef.current.get(args.selectedElement.expressID)
    if (!customObject) return
    customObject.rotation.set(normalized.x, normalized.y, normalized.z)
    customObject.updateMatrix()
    customObject.matrixAutoUpdate = false
    return
  }

  const center =
    args.getElementWorldPosition(args.selectedElement.modelID, args.selectedElement.expressID) ??
    args.getBaseCenter(args.selectedElement.modelID, args.selectedElement.expressID)
  if (!center) return
  args.applyIfcElementTransform(
    args.selectedElement.modelID,
    args.selectedElement.expressID,
    { dx: center.x, dy: center.y, dz: center.z },
    normalized
  )
}
