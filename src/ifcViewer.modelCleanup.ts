import { FrontSide } from 'three'
import { IfcViewerAPI } from './viewer/IfcViewerAPICompat'
import { CUSTOM_CUBE_MODEL_ID } from './hooks/useSelectionOffsets'

type IfcMeshLike = {
  modelID?: number
  geometry?: { dispose?: () => void }
  material?:
    | {
        dispose?: () => void
        side?: number
        depthTest?: boolean
        depthWrite?: boolean
        transparent?: boolean
        polygonOffset?: boolean
        polygonOffsetFactor?: number
        polygonOffsetUnits?: number
        needsUpdate?: boolean
      }
    | Array<{
        dispose?: () => void
        side?: number
        depthTest?: boolean
        depthWrite?: boolean
        transparent?: boolean
        polygonOffset?: boolean
        polygonOffsetFactor?: number
        polygonOffsetUnits?: number
        needsUpdate?: boolean
      }>
}

type IfcSceneLike = {
  children?: unknown[]
  remove: (item: unknown) => void
}

// This function disposes IFC mesh geometry and materials before a model is removed from the scene.
export const disposeMeshResources = (mesh: IfcMeshLike | null | undefined) => {
  if (!mesh) return
  mesh.geometry?.dispose?.()
  if (Array.isArray(mesh.material)) {
    mesh.material.forEach((material) => material?.dispose?.())
    return
  }
  mesh.material?.dispose?.()
}

// This function removes all meshes for one IFC model id from a mutable model collection.
export const removeMeshesByModelId = (collection: unknown[] | undefined, modelID: number) => {
  if (!Array.isArray(collection)) return
  for (let index = collection.length - 1; index >= 0; index -= 1) {
    const item = collection[index] as { modelID?: number }
    if (item?.modelID === modelID) {
      collection.splice(index, 1)
    }
  }
}

// This function gathers every currently known IFC model id so a reload can clean them up deterministically.
export const collectLoadedIfcModelIds = (viewer: IfcViewerAPI, fallbackModelID: number | null): number[] => {
  const ids = new Set<number>()
  if (typeof fallbackModelID === 'number') {
    ids.add(fallbackModelID)
  }

  const manager = viewer.IFC.loader.ifcManager as {
    state?: { models?: Record<string, { mesh?: unknown }> }
  }
  const models = manager.state?.models ?? {}
  Object.keys(models).forEach((rawId) => {
    const parsed = Number(rawId)
    if (Number.isFinite(parsed)) {
      ids.add(parsed)
    }
  })

  ;(viewer.context.items.ifcModels as Array<{ modelID?: number }>).forEach((mesh) => {
    if (typeof mesh?.modelID === 'number') {
      ids.add(mesh.modelID)
    }
  })

  return Array.from(ids)
}

// This function removes one IFC model through the safest available path and purges its remaining scene objects.
export const removeIfcModelSafely = (viewer: IfcViewerAPI, modelID: number) => {
  const manager = viewer.IFC.loader.ifcManager as {
    close?: (id: number, scene?: unknown) => void
    state?: { models?: Record<number, { mesh?: unknown }> }
  }
  const scene = viewer.context.getScene() as IfcSceneLike

  if (manager.state?.models?.[modelID]) {
    try {
      manager.close?.(modelID, scene)
    } catch (err) {
      console.warn('Failed to close IFC model', modelID, err)
    }
  } else {
    try {
      viewer.IFC.removeIfcModel(modelID)
    } catch (err) {
      console.warn('Failed to remove IFC model', modelID, err)
    }
  }

  const children = Array.isArray(scene.children) ? [...scene.children] : []
  children.forEach((child) => {
    const mesh = child as IfcMeshLike
    if (mesh?.modelID !== modelID) return
    scene.remove(child)
    disposeMeshResources(mesh)
  })

  removeMeshesByModelId(viewer.context.items.ifcModels as unknown[], modelID)
  removeMeshesByModelId(viewer.context.items.pickableIfcModels as unknown[], modelID)
}

// This function removes orphaned IFC visuals that can remain in the scene after a model reload or replacement.
export const purgeIfcVisuals = (viewer: IfcViewerAPI, modelIDsToRemove: number[]) => {
  const modelIdSet = new Set(modelIDsToRemove)
  const scene = viewer.context.getScene() as IfcSceneLike
  const removed = new Set<unknown>()
  const stack = Array.isArray(scene.children) ? [...scene.children] : []

  while (stack.length > 0) {
    const current = stack.pop() as IfcMeshLike & {
      modelID?: number
      geometry?: { getAttribute?: (name: string) => unknown; dispose?: () => void }
      material?: { dispose?: () => void } | Array<{ dispose?: () => void }>
      children?: unknown[]
      parent?: { remove?: (item: unknown) => void }
    }
    if (!current) continue
    if (Array.isArray(current.children) && current.children.length > 0) {
      stack.push(...current.children)
    }

    const modelID = typeof current.modelID === 'number' ? current.modelID : null
    const isCustomCube = modelID === CUSTOM_CUBE_MODEL_ID
    const hasExpressIds = Boolean(current.geometry?.getAttribute?.('expressID'))
    const shouldRemoveByModelID = modelID !== null && modelIdSet.has(modelID) && !isCustomCube
    const shouldRemoveOrphanIfcVisual = hasExpressIds && !isCustomCube
    if (!shouldRemoveByModelID && !shouldRemoveOrphanIfcVisual) continue

    if (current.parent?.remove) {
      current.parent.remove(current)
    }
    disposeMeshResources(current)
    removed.add(current)
  }

  const purgeCollection = (collection: unknown[] | undefined) => {
    if (!Array.isArray(collection)) return
    for (let index = collection.length - 1; index >= 0; index -= 1) {
      const item = collection[index] as {
        modelID?: number
        geometry?: { getAttribute?: (name: string) => unknown }
      }
      const modelID = typeof item?.modelID === 'number' ? item.modelID : null
      const isCustomCube = modelID === CUSTOM_CUBE_MODEL_ID
      const hasExpressIds = Boolean(item?.geometry?.getAttribute?.('expressID'))
      const shouldRemoveByModelID = modelID !== null && modelIdSet.has(modelID) && !isCustomCube
      const shouldRemoveOrphanIfcVisual = hasExpressIds && !isCustomCube
      if (removed.has(item) || shouldRemoveByModelID || shouldRemoveOrphanIfcVisual) {
        collection.splice(index, 1)
      }
    }
  }

  purgeCollection(viewer.context.items.ifcModels as unknown[])
  purgeCollection(viewer.context.items.pickableIfcModels as unknown[])
}

// This function applies the stable IFC material settings used to reduce visual artifacts in the viewer.
export const tuneIfcMeshMaterial = (
  material:
    | {
        side?: number
        depthTest?: boolean
        depthWrite?: boolean
        transparent?: boolean
        polygonOffset?: boolean
        polygonOffsetFactor?: number
        polygonOffsetUnits?: number
        needsUpdate?: boolean
      }
    | null
    | undefined
) => {
  if (!material) return
  // FrontSide is much more stable for IFC models that contain coplanar or duplicated faces.
  material.side = FrontSide
  material.depthTest = true
  material.depthWrite = true
  material.polygonOffset = false
  material.polygonOffsetFactor = 0
  material.polygonOffsetUnits = 0
  material.needsUpdate = true
}

// This function walks an IFC model subtree and reapplies the preferred viewer material settings everywhere.
export const tuneIfcModelMaterials = (model: unknown) => {
  if (!model) return
  const stack: Array<
    IfcMeshLike & {
      children?: unknown[]
    }
  > = [model as IfcMeshLike & { children?: unknown[] }]
  while (stack.length > 0) {
    const current = stack.pop()
    if (!current) continue
    if (Array.isArray(current.material)) {
      current.material.forEach((material) => tuneIfcMeshMaterial(material))
    } else {
      tuneIfcMeshMaterial(current.material)
    }
    if (Array.isArray(current.children) && current.children.length > 0) {
      current.children.forEach((child) =>
        stack.push(child as IfcMeshLike & { children?: unknown[] })
      )
    }
  }
}
