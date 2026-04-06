import type { MutableRefObject } from 'react'
import { Matrix4, Mesh, Quaternion, Vector3 } from 'three'
import type { OffsetVector, Point3D } from '../ifcViewerTypes'
import type { IfcViewerAPI } from '../viewer/IfcViewerAPICompat'
import { CUSTOM_CUBE_MODEL_ID } from './selectionOffsets.shared'
import { buildObjectPlacementMatrix } from './selectionOffsets.ifc'

// Loads and caches the coordination matrix that maps IFC placement data into the viewer space.
export const getModelCoordinationMatrix = async (args: {
  viewer: IfcViewerAPI
  modelID: number
  coordinationMatrixRef: MutableRefObject<Map<number, Matrix4 | null>>
}): Promise<Matrix4 | null> => {
  if (args.coordinationMatrixRef.current.has(args.modelID)) {
    return args.coordinationMatrixRef.current.get(args.modelID) ?? null
  }

  try {
    const rawMatrix = await args.viewer.IFC.loader.ifcManager.getCoordinationMatrix(args.modelID)
    if (Array.isArray(rawMatrix) && rawMatrix.length === 16) {
      const matrix = new Matrix4().fromArray(rawMatrix.map((value) => Number(value) || 0))
      args.coordinationMatrixRef.current.set(args.modelID, matrix)
      return matrix
    }
  } catch (error) {
    console.warn('Failed to get coordination matrix for model', args.modelID, error)
  }

  args.coordinationMatrixRef.current.set(args.modelID, null)
  return null
}

// Resolves and caches the IFC placement origin of one element in viewer coordinates.
export const primeIfcPlacementOrigin = async (args: {
  viewer: IfcViewerAPI
  modelID: number
  expressID: number
  properties?: any
  placementOriginsRef: MutableRefObject<Map<string, Point3D>>
  coordinationMatrixRef: MutableRefObject<Map<number, Matrix4 | null>>
  getElementKey: (modelID: number, expressID: number) => string
}): Promise<Point3D | null> => {
  const key = args.getElementKey(args.modelID, args.expressID)
  const cached = args.placementOriginsRef.current.get(key)
  if (cached) {
    return cached
  }

  try {
    const properties =
      args.properties ??
      (await args.viewer.IFC.getProperties(args.modelID, args.expressID, false, true))
    const placementMatrix = buildObjectPlacementMatrix(properties?.ObjectPlacement)
    if (!placementMatrix) {
      return null
    }

    const origin = new Vector3(0, 0, 0).applyMatrix4(placementMatrix)
    const coordinationMatrix = await getModelCoordinationMatrix({
      viewer: args.viewer,
      modelID: args.modelID,
      coordinationMatrixRef: args.coordinationMatrixRef
    })
    if (coordinationMatrix) {
      origin.applyMatrix4(coordinationMatrix)
    }

    const point = { x: origin.x, y: origin.y, z: origin.z }
    args.placementOriginsRef.current.set(key, point)
    return point
  } catch (error) {
    console.warn('Failed to prime IFC placement origin', args.modelID, args.expressID, error)
    return null
  }
}

// Returns the base world offset of one IFC model from its mesh or base subset transform.
export const getModelBaseOffset = (args: {
  viewer: IfcViewerAPI | null
  modelID: number
  baseSubsetsRef: MutableRefObject<Map<number, Mesh>>
}): OffsetVector => {
  const mesh = args.viewer?.IFC.loader.ifcManager.state?.models?.[args.modelID]?.mesh as Mesh | undefined
  if (mesh) {
    mesh.updateMatrixWorld(true)
    const pos = new Vector3()
    const quat = new Quaternion()
    const scale = new Vector3()
    mesh.matrixWorld.decompose(pos, quat, scale)
    return { dx: pos.x, dy: pos.y, dz: pos.z }
  }

  const subset = args.baseSubsetsRef.current.get(args.modelID)
  if (subset) {
    subset.updateMatrixWorld(true)
    const pos = new Vector3()
    const quat = new Quaternion()
    const scale = new Vector3()
    subset.matrixWorld.decompose(pos, quat, scale)
    return { dx: pos.x, dy: pos.y, dz: pos.z }
  }

  return { dx: 0, dy: 0, dz: 0 }
}

// Computes and caches the geometric base center used as the editor pivot for one IFC element.
export const getBaseCenter = (args: {
  viewer: IfcViewerAPI
  modelID: number
  expressID: number
  baseCentersRef: MutableRefObject<Map<string, Point3D>>
  getElementKey: (modelID: number, expressID: number) => string
  hasRenderableExpressId: (modelID: number, expressID: number) => boolean
}): Point3D | null => {
  const key = args.getElementKey(args.modelID, args.expressID)
  const cached = args.baseCentersRef.current.get(key)
  if (cached) {
    return cached
  }
  if (!args.hasRenderableExpressId(args.modelID, args.expressID)) {
    return null
  }

  const manager = args.viewer.IFC.loader.ifcManager
  const scene = args.viewer.context.getScene()
  const customId = `base-center-${args.modelID}-${args.expressID}`
  const subset = manager.createSubset({
    modelID: args.modelID,
    ids: [args.expressID],
    scene,
    removePrevious: true,
    customID: customId
  }) as Mesh | null

  if (!subset) {
    return null
  }

  const cleanup = () => {
    scene.remove(subset)
    manager.removeSubset(args.modelID, undefined, customId)
  }

  subset.geometry.computeBoundingBox()
  const bbox = subset.geometry.boundingBox
  if (!bbox) {
    cleanup()
    return null
  }

  const center = new Vector3(
    (bbox.min.x + bbox.max.x) / 2,
    bbox.min.y,
    (bbox.min.z + bbox.max.z) / 2
  )
  subset.updateMatrixWorld(true)
  center.applyMatrix4(subset.matrixWorld)
  cleanup()

  const point = { x: center.x, y: center.y, z: center.z }
  args.baseCentersRef.current.set(key, point)
  return point
}

// Returns the current world position of an element by combining its base center with any applied offset.
export const getElementWorldPosition = (args: {
  modelID: number
  expressID: number
  cubeRegistryRef: MutableRefObject<Map<number, Mesh>>
  elementOffsetsRef: MutableRefObject<Map<string, OffsetVector>>
  getElementKey: (modelID: number, expressID: number) => string
  getBaseCenter: (modelID: number, expressID: number) => Point3D | null
}): Point3D | null => {
  if (args.modelID === CUSTOM_CUBE_MODEL_ID) {
    const customObject = args.cubeRegistryRef.current.get(args.expressID)
    return customObject
      ? { x: customObject.position.x, y: customObject.position.y, z: customObject.position.z }
      : null
  }

  const key = args.getElementKey(args.modelID, args.expressID)
  const baseCenter = args.getBaseCenter(args.modelID, args.expressID)
  if (!baseCenter) return null
  const offset = args.elementOffsetsRef.current.get(key)
  return offset
    ? { x: offset.dx, y: offset.dy, z: offset.dz }
    : { x: baseCenter.x, y: baseCenter.y, z: baseCenter.z }
}

// Returns the immutable base editor position of an element before any offsets are applied.
export const getIfcElementBasePosition = (args: {
  modelID: number
  expressID: number
  cubeRegistryRef: MutableRefObject<Map<number, Mesh>>
  getBaseCenter: (modelID: number, expressID: number) => Point3D | null
}): Point3D | null => {
  if (args.modelID === CUSTOM_CUBE_MODEL_ID) {
    const customObject = args.cubeRegistryRef.current.get(args.expressID)
    return customObject
      ? { x: customObject.position.x, y: customObject.position.y, z: customObject.position.z }
      : null
  }
  const baseCenter = args.getBaseCenter(args.modelID, args.expressID)
  if (!baseCenter) return null
  return { x: baseCenter.x, y: baseCenter.y, z: baseCenter.z }
}

// Resolves the current IFC placement origin after applying any moved subset or editor offset.
export const getIfcElementPlacementPosition = (args: {
  viewer: IfcViewerAPI | null
  modelID: number
  expressID: number
  placementOriginsRef: MutableRefObject<Map<string, Point3D>>
  movedSubsetsRef: MutableRefObject<Map<string, Mesh>>
  baseSubsetsRef: MutableRefObject<Map<number, Mesh>>
  elementOffsetsRef: MutableRefObject<Map<string, OffsetVector>>
  getElementKey: (modelID: number, expressID: number) => string
  getBaseCenter: (modelID: number, expressID: number) => Point3D | null
}): Point3D | null => {
  if (args.modelID === CUSTOM_CUBE_MODEL_ID) {
    return null
  }

  const key = args.getElementKey(args.modelID, args.expressID)
  const basePlacement = args.placementOriginsRef.current.get(key)
  if (!basePlacement) {
    return null
  }

  const moved = args.movedSubsetsRef.current.get(key)
  if (moved) {
    const baseSubset = args.baseSubsetsRef.current.get(args.modelID)
    const modelMesh = args.viewer?.IFC.loader.ifcManager.state?.models?.[args.modelID]?.mesh as
      | Mesh
      | undefined
    const baseMatrix = new Matrix4()
    if (baseSubset) {
      baseSubset.updateMatrixWorld(true)
      baseMatrix.copy(baseSubset.matrixWorld)
    } else if (modelMesh) {
      modelMesh.updateMatrixWorld(true)
      baseMatrix.copy(modelMesh.matrixWorld)
    } else {
      baseMatrix.identity()
    }

    const baseInverse = new Matrix4().copy(baseMatrix).invert()
    const localOrigin = new Vector3(basePlacement.x, basePlacement.y, basePlacement.z).applyMatrix4(
      baseInverse
    )
    moved.updateMatrixWorld(true)
    const currentOrigin = localOrigin.applyMatrix4(moved.matrixWorld)
    return { x: currentOrigin.x, y: currentOrigin.y, z: currentOrigin.z }
  }

  const offset = args.elementOffsetsRef.current.get(key)
  const baseCenter = args.getBaseCenter(args.modelID, args.expressID)
  if (offset && baseCenter) {
    return {
      x: basePlacement.x + (offset.dx - baseCenter.x),
      y: basePlacement.y + (offset.dy - baseCenter.y),
      z: basePlacement.z + (offset.dz - baseCenter.z)
    }
  }

  return { x: basePlacement.x, y: basePlacement.y, z: basePlacement.z }
}

// Ensures the IFC placement origin is available by loading properties only when the cache is empty.
export const ensureIfcPlacementPosition = async (args: {
  viewer: IfcViewerAPI
  modelID: number
  expressID: number
  getIfcElementPlacementPosition: (modelID: number, expressID: number) => Point3D | null
  primeIfcPlacementOrigin: (modelID: number, expressID: number, properties?: any) => Promise<Point3D | null>
}): Promise<Point3D | null> => {
  if (args.modelID === CUSTOM_CUBE_MODEL_ID) {
    return null
  }

  const cached = args.getIfcElementPlacementPosition(args.modelID, args.expressID)
  if (cached) {
    return cached
  }

  try {
    const properties = await args.viewer.IFC.getProperties(args.modelID, args.expressID, false, true)
    return await args.primeIfcPlacementOrigin(args.modelID, args.expressID, properties)
  } catch (error) {
    console.warn('Failed to ensure IFC placement position', args.modelID, args.expressID, error)
    return null
  }
}

// Computes the translation delta between the original IFC placement and the current editor placement.
export const getIfcElementTranslationDelta = (args: {
  modelID: number
  expressID: number
  placementOriginsRef: MutableRefObject<Map<string, Point3D>>
  elementOffsetsRef: MutableRefObject<Map<string, OffsetVector>>
  getElementKey: (modelID: number, expressID: number) => string
  getIfcElementPlacementPosition: (modelID: number, expressID: number) => Point3D | null
  getBaseCenter: (modelID: number, expressID: number) => Point3D | null
}): Point3D | null => {
  if (args.modelID === CUSTOM_CUBE_MODEL_ID) {
    return null
  }
  const key = args.getElementKey(args.modelID, args.expressID)
  const basePlacement = args.placementOriginsRef.current.get(key)
  const currentPlacement = args.getIfcElementPlacementPosition(args.modelID, args.expressID)
  if (basePlacement && currentPlacement) {
    return {
      x: currentPlacement.x - basePlacement.x,
      y: currentPlacement.y - basePlacement.y,
      z: currentPlacement.z - basePlacement.z
    }
  }

  const offset = args.elementOffsetsRef.current.get(key)
  const baseCenter = args.getBaseCenter(args.modelID, args.expressID)
  if (!baseCenter) return null
  if (!offset) {
    return { x: 0, y: 0, z: 0 }
  }
  return {
    x: offset.dx - baseCenter.x,
    y: offset.dy - baseCenter.y,
    z: offset.dz - baseCenter.z
  }
}

// Returns the current rotation delta stored for an IFC element or direct rotation for a custom object.
export const getIfcElementRotationDelta = (args: {
  modelID: number
  expressID: number
  cubeRegistryRef: MutableRefObject<Map<number, Mesh>>
  elementRotationsRef: MutableRefObject<Map<string, Point3D>>
  getElementKey: (modelID: number, expressID: number) => string
}): Point3D | null => {
  if (args.modelID === CUSTOM_CUBE_MODEL_ID) {
    const customObject = args.cubeRegistryRef.current.get(args.expressID)
    if (!customObject) return null
    return {
      x: customObject.rotation.x,
      y: customObject.rotation.y,
      z: customObject.rotation.z
    }
  }
  const key = args.getElementKey(args.modelID, args.expressID)
  const stored = args.elementRotationsRef.current.get(key)
  if (stored) {
    return { x: stored.x, y: stored.y, z: stored.z }
  }
  return { x: 0, y: 0, z: 0 }
}
