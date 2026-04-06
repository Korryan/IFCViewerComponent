import type { MutableRefObject } from 'react'
import { BoxGeometry, Float32BufferAttribute, Mesh, MeshStandardMaterial } from 'three'
import type { FurnitureGeometry, Point3D, PropertyField } from '../ifcViewerTypes'
import type { IfcViewerAPI } from '../viewer/IfcViewerAPICompat'
import { buildUploadedFurnitureName } from '../ifcViewer.utils'
import { buildCenteredCustomObject, buildCustomObjectFromStoredGeometry, serializeMeshGeometry } from './selectionOffsets.customObjects'
import { tuneIfcModelMaterials } from './selectionOffsets.ifc'
import {
  CUBE_BASE_COLOR,
  CUBE_HIGHLIGHT_COLOR,
  CUSTOM_CUBE_MODEL_ID,
  CUSTOM_HIGHLIGHT_EMISSIVE
} from './selectionOffsets.shared'

export type SpawnedCubeInfo = {
  expressID: number
  position: Point3D
}

export type SpawnedModelInfo = {
  modelID: number
  expressID: number
  position: Point3D
  geometry: FurnitureGeometry | null
}

export type CustomObjectState = {
  itemId?: string
  model: string
  name?: string
  roomNumber?: string
  spaceIfcId?: number
  sourceFileName?: string
}

export type SpawnStoredCustomObjectArgs = {
  itemId: string
  model: string
  name?: string | null
  position: Point3D
  rotation?: Point3D | null
  geometry: FurnitureGeometry
  roomNumber?: string | null
  spaceIfcId?: number | null
  sourceFileName?: string | null
  focus?: boolean
}

export type CustomObjectRegistryRefs = {
  cubeRegistryRef: MutableRefObject<Map<number, Mesh>>
  cubeIdCounterRef: MutableRefObject<number>
  highlightedCubeRef: MutableRefObject<number | null>
  customCubeRoomsRef: MutableRefObject<Map<number, string>>
  customObjectSpaceIfcIdsRef: MutableRefObject<Map<number, number>>
  customObjectModelsRef: MutableRefObject<Map<number, string>>
  customObjectNamesRef: MutableRefObject<Map<number, string>>
  customObjectItemIdsRef: MutableRefObject<Map<number, string>>
  customObjectSourceFilesRef: MutableRefObject<Map<number, string>>
}

// Stores the room number associated with a custom object.
export const setCustomObjectRoomNumber = (
  refs: CustomObjectRegistryRefs,
  expressID: number,
  roomNumber?: string | null
) => {
  if (!Number.isFinite(expressID)) return
  if (!roomNumber) {
    refs.customCubeRoomsRef.current.delete(expressID)
    return
  }
  refs.customCubeRoomsRef.current.set(expressID, roomNumber)
}

// Stores the owning IfcSpace id associated with a custom object.
export const setCustomObjectSpaceIfcId = (
  refs: CustomObjectRegistryRefs,
  expressID: number,
  spaceIfcId?: number | null
) => {
  if (!Number.isFinite(expressID)) return
  if (typeof spaceIfcId !== 'number' || !Number.isFinite(spaceIfcId)) {
    refs.customObjectSpaceIfcIdsRef.current.delete(expressID)
    return
  }
  refs.customObjectSpaceIfcIdsRef.current.set(expressID, Math.trunc(spaceIfcId))
}

// Stores the persisted item id associated with a custom object.
export const setCustomObjectItemId = (
  refs: CustomObjectRegistryRefs,
  expressID: number,
  itemId?: string | null
) => {
  if (!Number.isFinite(expressID)) return
  if (!itemId) {
    refs.customObjectItemIdsRef.current.delete(expressID)
    return
  }
  refs.customObjectItemIdsRef.current.set(expressID, itemId)
}

// Finds the custom express id already linked to a persisted item id.
export const findCustomObjectExpressIdByItemId = (
  refs: CustomObjectRegistryRefs,
  itemId: string | null | undefined
): number | null => {
  if (!itemId) return null
  for (const [expressID, currentItemId] of refs.customObjectItemIdsRef.current.entries()) {
    if (currentItemId === itemId) {
      return expressID
    }
  }
  return null
}

// Returns the tracked metadata associated with a custom object.
export const getCustomObjectState = (
  refs: CustomObjectRegistryRefs,
  expressID: number
): CustomObjectState | null => {
  if (!Number.isFinite(expressID)) return null
  const model = refs.customObjectModelsRef.current.get(expressID)
  if (!model) return null
  return {
    itemId: refs.customObjectItemIdsRef.current.get(expressID),
    model,
    name: refs.customObjectNamesRef.current.get(expressID),
    roomNumber: refs.customCubeRoomsRef.current.get(expressID),
    spaceIfcId: refs.customObjectSpaceIfcIdsRef.current.get(expressID),
    sourceFileName: refs.customObjectSourceFilesRef.current.get(expressID)
  }
}

// Updates the non-positional metadata tracked for a custom object.
export const rememberCustomObjectState = (
  refs: CustomObjectRegistryRefs,
  expressID: number,
  state: Omit<CustomObjectState, 'itemId' | 'roomNumber' | 'spaceIfcId'>
) => {
  if (!Number.isFinite(expressID)) return
  refs.customObjectModelsRef.current.set(expressID, state.model)
  if (state.name) {
    refs.customObjectNamesRef.current.set(expressID, state.name)
  } else {
    refs.customObjectNamesRef.current.delete(expressID)
  }
  if (state.sourceFileName) {
    refs.customObjectSourceFilesRef.current.set(expressID, state.sourceFileName)
  } else {
    refs.customObjectSourceFilesRef.current.delete(expressID)
  }
}

// Applies or clears highlight colors on the active custom object.
export const setCustomObjectHighlight = (
  refs: CustomObjectRegistryRefs,
  expressID: number | null
) => {
  const restoreMaterials = (object: Mesh | undefined) => {
    object?.traverse((entry: any) => {
      const materials = Array.isArray(entry?.material) ? entry.material : [entry?.material]
      materials.forEach((material: any) => {
        if (!material) return
        const userData = (material.userData ??= {})
        if (material.color && typeof userData.__bakaBaseColor === 'number') {
          material.color.set(userData.__bakaBaseColor)
        }
        if (material.emissive && typeof userData.__bakaBaseEmissive === 'number') {
          material.emissive.set(userData.__bakaBaseEmissive)
        }
        material.needsUpdate = true
      })
    })
  }

  const applyHighlight = (object: Mesh | undefined) => {
    object?.traverse((entry: any) => {
      const materials = Array.isArray(entry?.material) ? entry.material : [entry?.material]
      materials.forEach((material: any) => {
        if (!material) return
        const userData = (material.userData ??= {})
        if (material.color && typeof userData.__bakaBaseColor !== 'number') {
          userData.__bakaBaseColor = material.color.getHex()
        }
        if (material.emissive && typeof userData.__bakaBaseEmissive !== 'number') {
          userData.__bakaBaseEmissive = material.emissive.getHex()
        }
        if (material.color) {
          material.color.set(CUBE_HIGHLIGHT_COLOR)
        }
        if (material.emissive) {
          material.emissive.set(CUSTOM_HIGHLIGHT_EMISSIVE)
        }
        material.needsUpdate = true
      })
    })
  }

  if (
    refs.highlightedCubeRef.current !== null &&
    refs.highlightedCubeRef.current !== expressID
  ) {
    restoreMaterials(refs.cubeRegistryRef.current.get(refs.highlightedCubeRef.current))
  }

  if (expressID === null) {
    refs.highlightedCubeRef.current = null
    return
  }

  applyHighlight(refs.cubeRegistryRef.current.get(expressID))
  refs.highlightedCubeRef.current = expressID
}

// Re-registers all custom objects as pickable items after viewer reloads.
export const ensureCustomObjectsPickable = (
  viewer: IfcViewerAPI,
  refs: CustomObjectRegistryRefs
) => {
  const pickables = viewer.context.items.pickableIfcModels
  refs.cubeRegistryRef.current.forEach((cube) => {
    if (!pickables.includes(cube as any)) {
      pickables.push(cube as any)
    }
  })
}

// Builds the property panel fields for a selected custom object.
export const buildCustomPropertyFields = (
  refs: CustomObjectRegistryRefs,
  expressID: number
): PropertyField[] => {
  const state = getCustomObjectState(refs, expressID)
  if (!state) {
    return [{ key: 'name', label: 'Name', value: `Object #${expressID}` }]
  }

  const fields: PropertyField[] = [
    { key: 'name', label: 'Name', value: state.name || `Object #${expressID}` }
  ]
  if (state.roomNumber) {
    fields.push({ key: 'roomNumber', label: 'Room', value: state.roomNumber })
  }
  if (state.sourceFileName) {
    fields.push({ key: 'sourceFileName', label: 'Source file', value: state.sourceFileName })
  }
  return fields
}

// Clears all metadata tracked for a single custom object.
export const clearCustomObjectState = (
  refs: CustomObjectRegistryRefs,
  expressID: number
) => {
  refs.customCubeRoomsRef.current.delete(expressID)
  refs.customObjectSpaceIfcIdsRef.current.delete(expressID)
  refs.customObjectModelsRef.current.delete(expressID)
  refs.customObjectNamesRef.current.delete(expressID)
  refs.customObjectItemIdsRef.current.delete(expressID)
  refs.customObjectSourceFilesRef.current.delete(expressID)
  if (refs.highlightedCubeRef.current === expressID) {
    refs.highlightedCubeRef.current = null
  }
}

// Clears every custom object from the scene and resets the registry maps.
export const clearAllCustomObjects = (
  viewer: IfcViewerAPI,
  refs: CustomObjectRegistryRefs,
  removePickable: (viewer: IfcViewerAPI, mesh: Mesh) => void
) => {
  const scene = viewer.context.getScene()
  refs.cubeRegistryRef.current.forEach((customObject) => {
    scene.remove(customObject)
    removePickable(viewer, customObject)
  })
  refs.cubeRegistryRef.current.clear()
  refs.customCubeRoomsRef.current.clear()
  refs.customObjectSpaceIfcIdsRef.current.clear()
  refs.customObjectModelsRef.current.clear()
  refs.customObjectNamesRef.current.clear()
  refs.customObjectItemIdsRef.current.clear()
  refs.customObjectSourceFilesRef.current.clear()
  refs.highlightedCubeRef.current = null
}

// Registers a new custom object in the scene and pickable list.
const registerCustomObject = (
  viewer: IfcViewerAPI,
  refs: CustomObjectRegistryRefs,
  expressID: number,
  customObject: Mesh
) => {
  refs.cubeRegistryRef.current.set(expressID, customObject)
  viewer.context.getScene().add(customObject)
  viewer.context.items.pickableIfcModels.push(customObject as any)
}

// Advances the custom-object id counter so restored ids do not collide with new ones.
const resolveCustomObjectId = (
  refs: CustomObjectRegistryRefs,
  id?: number
): number => {
  const resolvedId =
    typeof id === 'number' && Number.isFinite(id) && id > 0
      ? Math.trunc(id)
      : refs.cubeIdCounterRef.current++
  if (resolvedId >= refs.cubeIdCounterRef.current) {
    refs.cubeIdCounterRef.current = resolvedId + 1
  }
  return resolvedId
}

// Creates a cube custom object or repositions an existing cube id.
export const spawnCubeObject = (
  viewer: IfcViewerAPI,
  refs: CustomObjectRegistryRefs,
  target?: Point3D | null,
  id?: number
): SpawnedCubeInfo | null => {
  const geometry = new BoxGeometry(1, 1, 1)
  const material = new MeshStandardMaterial({
    color: CUBE_BASE_COLOR,
    metalness: 0.1,
    roughness: 0.8
  })
  const cube = new Mesh(geometry, material)
  const position = target ?? { x: 0, y: 0, z: 0 }
  cube.position.set(position.x, position.y, position.z)

  const resolvedId = resolveCustomObjectId(refs, id)
  const existing = refs.cubeRegistryRef.current.get(resolvedId)
  if (existing) {
    existing.position.set(position.x, position.y, position.z)
    existing.updateMatrix()
    existing.matrixAutoUpdate = false
    return { expressID: resolvedId, position }
  }

  const positionAttr = cube.geometry.getAttribute('position')
  const vertexCount = positionAttr ? positionAttr.count : 0
  const ids = new Float32Array(vertexCount)
  ids.fill(resolvedId)
  cube.geometry.setAttribute('expressID', new Float32BufferAttribute(ids, 1))
  ;(cube as any).modelID = CUSTOM_CUBE_MODEL_ID

  registerCustomObject(viewer, refs, resolvedId, cube)
  rememberCustomObjectState(refs, resolvedId, {
    model: 'cube',
    name: `Cube #${resolvedId}`
  })
  return { expressID: resolvedId, position }
}

// Loads an uploaded IFC file and converts it into a centered custom object.
export const spawnUploadedCustomObject = async (
  viewer: IfcViewerAPI,
  refs: CustomObjectRegistryRefs,
  file: File,
  target?: Point3D | null
): Promise<SpawnedModelInfo | null> => {
  const resolved = target ?? { x: 0, y: 0, z: 0 }
  await viewer.IFC.applyWebIfcConfig({
    COORDINATE_TO_ORIGIN: true,
    USE_FAST_BOOLS: false
  })
  const model = (await viewer.IFC.loadIfc(file, false)) as Mesh | undefined
  if (!model) return null

  tuneIfcModelMaterials(model)
  const initialSerialized = serializeMeshGeometry(model)
  const expressID = refs.cubeIdCounterRef.current++
  const customObject = buildCenteredCustomObject(model, initialSerialized.center, expressID)
  const sourceModelId = (model as { modelID?: number }).modelID
  if (typeof sourceModelId === 'number') {
    viewer.IFC.removeIfcModel(sourceModelId)
  }
  if (!customObject) {
    return null
  }

  customObject.position.set(resolved.x, resolved.y, resolved.z)
  customObject.updateMatrixWorld(true)
  registerCustomObject(viewer, refs, expressID, customObject as unknown as Mesh)
  rememberCustomObjectState(refs, expressID, {
    model: 'uploaded-ifc',
    name: buildUploadedFurnitureName(file.name),
    sourceFileName: file.name
  })
  return {
    modelID: CUSTOM_CUBE_MODEL_ID,
    expressID,
    position: resolved,
    geometry: initialSerialized.geometry
  }
}

// Restores a persisted custom object from stored geometry into the scene.
export const spawnStoredCustomObject = (
  viewer: IfcViewerAPI,
  refs: CustomObjectRegistryRefs,
  args: SpawnStoredCustomObjectArgs
): { expressID: number; position: Point3D } | null => {
  const {
    itemId,
    model,
    name,
    position,
    rotation,
    geometry,
    roomNumber,
    spaceIfcId,
    sourceFileName
  } = args

  const existingExpressId = findCustomObjectExpressIdByItemId(refs, itemId)
  const expressID = existingExpressId ?? refs.cubeIdCounterRef.current++
  const existing = refs.cubeRegistryRef.current.get(expressID)
  if (existing) {
    existing.position.set(position.x, position.y, position.z)
    existing.rotation.set(rotation?.x ?? 0, rotation?.y ?? 0, rotation?.z ?? 0)
    existing.updateMatrixWorld(true)
    setCustomObjectRoomNumber(refs, expressID, roomNumber)
    setCustomObjectSpaceIfcId(refs, expressID, spaceIfcId)
    setCustomObjectItemId(refs, expressID, itemId)
    rememberCustomObjectState(refs, expressID, {
      model,
      name: name ?? itemId,
      sourceFileName: sourceFileName ?? undefined
    })
    return { expressID, position }
  }

  const customObject = buildCustomObjectFromStoredGeometry(geometry, expressID)
  if (!customObject) return null

  customObject.position.set(position.x, position.y, position.z)
  customObject.rotation.set(rotation?.x ?? 0, rotation?.y ?? 0, rotation?.z ?? 0)
  customObject.updateMatrixWorld(true)
  registerCustomObject(viewer, refs, expressID, customObject as unknown as Mesh)
  rememberCustomObjectState(refs, expressID, {
    model,
    name: name ?? itemId,
    sourceFileName: sourceFileName ?? undefined
  })
  setCustomObjectRoomNumber(refs, expressID, roomNumber)
  setCustomObjectSpaceIfcId(refs, expressID, spaceIfcId)
  setCustomObjectItemId(refs, expressID, itemId)
  return { expressID, position }
}

// Removes one custom object from the scene, pickables, and metadata registries.
export const removeCustomObject = (
  viewer: IfcViewerAPI,
  refs: CustomObjectRegistryRefs,
  expressID: number,
  removePickable: (viewer: IfcViewerAPI, mesh: Mesh) => void
) => {
  const customObject = refs.cubeRegistryRef.current.get(expressID)
  if (!customObject) return
  viewer.context.getScene().remove(customObject)
  removePickable(viewer, customObject)
  refs.cubeRegistryRef.current.delete(expressID)
  clearCustomObjectState(refs, expressID)
}
