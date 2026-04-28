import type { Material, Object3D, Scene } from 'three'
import type { IfcModelLike, ModelRecord, ViewerSceneItems } from './IfcViewerAPICompat.types'
import { createSubsetRecord, detachSubsetRecord, removeIdsFromSubsetRecord } from './IfcViewerAPICompat.subsets'
import { addPickableObject, attachIfcModelToScene, removeModelFromSceneList, removePickableObject } from './IfcViewerAPICompat.scene'

// Tags every object in one scene subtree with the owning IFC model id.
export const tagViewerModelObject = (root: Object3D, modelID: number) => {
  root.traverse((entry: any) => {
    entry.modelID = modelID
  })
}

// Attaches one already loaded IFC mesh to the scene and refreshes camera bounds.
export const attachLoadedModel = (args: {
  scene: Scene
  items: ViewerSceneItems
  mesh: IfcModelLike | null | undefined
  updateSceneRadius: () => void
  updateCameraClipPlanes: () => void
}) => {
  attachIfcModelToScene({
    scene: args.scene,
    items: args.items,
    mesh: args.mesh
  })
  args.updateSceneRadius()
  args.updateCameraClipPlanes()
}

// Removes one loaded IFC model, its subsets, caches, and pickable scene objects.
export const removeLoadedModel = (args: {
  modelID: number
  modelsById: Map<number, ModelRecord>
  modelIdByKey: Map<string, number>
  ifcManagerState: Record<number, { mesh: IfcModelLike }>
  fragmentsManager: any
  items: ViewerSceneItems
  updateSceneRadius: () => void
  updateCameraClipPlanes: () => void
}) => {
  const record = args.modelsById.get(args.modelID)
  if (!record) {
    delete args.ifcManagerState[args.modelID]
    return
  }

  Array.from(record.subsets.keys()).forEach((subsetId) => {
    detachSubsetRecord({
      record,
      subsetId,
      removePickable: (object) => removePickableObject(args.items, object)
    })
  })

  removePickableObject(args.items, record.mesh)
  removeModelFromSceneList(args.items, record.mesh)
  record.mesh.parent?.remove(record.mesh)
  record.mesh.geometry?.dispose?.()

  record.geometryCache.forEach((entries) => {
    entries.forEach((entry) => entry.geometry.dispose())
  })

  args.modelsById.delete(args.modelID)
  args.modelIdByKey.delete(record.modelKey)
  delete args.ifcManagerState[args.modelID]

  try {
    void args.fragmentsManager.core.disposeModel(record.modelKey)
  } catch {
    // no-op
  }

  args.updateSceneRadius()
  args.updateCameraClipPlanes()
}

// Creates or replaces one subset mesh for a model and subset id pair.
export const createViewerSubset = (args: {
  config: {
    modelID: number
    ids: number[]
    scene?: Scene
    removePrevious?: boolean
    material?: Material | Material[]
    customID?: string
  }
  modelsById: Map<number, ModelRecord>
  fallbackScene: Scene
  items: ViewerSceneItems
}) => {
  const record = args.modelsById.get(args.config.modelID)
  if (!record) return null

  return createSubsetRecord({
    record,
    subsetId: args.config.customID || '__default__',
    ids: args.config.ids ?? [],
    scene: args.config.scene ?? args.fallbackScene,
    removePrevious: args.config.removePrevious,
    material: args.config.material,
    addPickable: (object) => addPickableObject(args.items, object),
    removePickable: (object) => removePickableObject(args.items, object),
    tagModelObject: tagViewerModelObject
  })
}

// Removes one subset mesh from a model by its custom subset id.
export const removeViewerSubset = (args: {
  modelID: number
  customID?: string
  modelsById: Map<number, ModelRecord>
  items: ViewerSceneItems
}) => {
  const record = args.modelsById.get(args.modelID)
  if (!record) return

  detachSubsetRecord({
    record,
    subsetId: args.customID || '__default__',
    removePickable: (object) => removePickableObject(args.items, object)
  })
}

// Removes a list of express ids from one existing subset mesh.
export const removeViewerSubsetIds = (args: {
  modelID: number
  ids: number[]
  customID?: string
  modelsById: Map<number, ModelRecord>
  fallbackScene: Scene
  items: ViewerSceneItems
}) => {
  const record = args.modelsById.get(args.modelID)
  if (!record) return

  removeIdsFromSubsetRecord({
    record,
    subsetId: args.customID || '__default__',
    ids: args.ids,
    fallbackScene: args.fallbackScene,
    addPickable: (object) => addPickableObject(args.items, object),
    removePickable: (object) => removePickableObject(args.items, object),
    tagModelObject: tagViewerModelObject
  })
}
