import type { MutableRefObject } from 'react'
import type { Mesh } from 'three'
import type { IfcViewerAPI } from '../viewer/IfcViewerAPICompat'
import { clearAllCustomObjects, type CustomObjectRegistryRefs } from './selectionOffsets.customRegistry'
import {
  BASE_SUBSET_ID,
  collectDerivedModelIds,
  getFilterSubsetId,
  getSpaceBiasSubsetId,
  getSelectionSubsetId,
  removeMovedSubset,
  syncSubsetMatrixFromSources
} from './selectionOffsets.subsets'

// Creates or reuses the base subset that hides the original model mesh and hosts per-element transforms.
export const ensureBaseSubset = (args: {
  viewer: IfcViewerAPI
  modelID: number
  baseSubsetsRef: MutableRefObject<Map<number, Mesh>>
  getAllExpressIdsForModel: (modelID: number) => number[]
  registerPickable: (viewer: IfcViewerAPI, mesh: Mesh, modelID?: number) => void
}): Mesh | null => {
  if (args.baseSubsetsRef.current.has(args.modelID)) {
    return args.baseSubsetsRef.current.get(args.modelID) || null
  }

  const ids = args.getAllExpressIdsForModel(args.modelID)
  if (ids.length === 0) {
    return null
  }

  const manager = args.viewer.IFC.loader.ifcManager
  const model = manager.state?.models?.[args.modelID]?.mesh as Mesh | undefined
  const subset = manager.createSubset({
    modelID: args.modelID,
    ids,
    scene: args.viewer.context.getScene(),
    removePrevious: true,
    customID: BASE_SUBSET_ID
  }) as Mesh | null

  if (!subset || !model) {
    return null
  }

  subset.matrix.copy(model.matrix)
  subset.matrixAutoUpdate = false
  model.visible = false

  args.baseSubsetsRef.current.set(args.modelID, subset)
  args.registerPickable(args.viewer, subset, args.modelID)
  return subset
}

// Rebuilds the optional space-bias subset that keeps room-related elements visible above the filter layer.
export const updateSpaceBiasSubset = (args: {
  viewer: IfcViewerAPI
  modelID: number
  allowedIds: Set<number> | null
  baseSubsetsRef: MutableRefObject<Map<number, Mesh>>
  spaceBiasSubsetsRef: MutableRefObject<Map<number, Mesh>>
  spaceBiasIdsRef: MutableRefObject<Map<number, Set<number>>>
  getMovedIdsForModel: (modelID: number) => Set<number>
  registerPickable: (viewer: IfcViewerAPI, mesh: Mesh, modelID?: number) => void
  removePickable: (viewer: IfcViewerAPI, mesh: Mesh) => void
  tuneSpaceBiasSubsetMesh: (mesh: Mesh | null | undefined) => void
}): void => {
  const manager = args.viewer.IFC.loader.ifcManager
  const scene = args.viewer.context.getScene()
  const targetIds = args.spaceBiasIdsRef.current.get(args.modelID)
  const existing = args.spaceBiasSubsetsRef.current.get(args.modelID)

  if (!targetIds || targetIds.size === 0) {
    if (existing) {
      scene.remove(existing)
      args.removePickable(args.viewer, existing)
      manager.removeSubset(args.modelID, undefined, getSpaceBiasSubsetId(args.modelID))
      args.spaceBiasSubsetsRef.current.delete(args.modelID)
    }
    return
  }

  const movedIds = args.getMovedIdsForModel(args.modelID)
  let idsToShow = Array.from(targetIds).filter((id) => !movedIds.has(id))
  if (args.allowedIds) {
    idsToShow = idsToShow.filter((id) => args.allowedIds!.has(id))
  }

  if (idsToShow.length === 0) {
    if (existing) {
      scene.remove(existing)
      args.removePickable(args.viewer, existing)
      manager.removeSubset(args.modelID, undefined, getSpaceBiasSubsetId(args.modelID))
      args.spaceBiasSubsetsRef.current.delete(args.modelID)
    }
    return
  }

  if (existing) {
    scene.remove(existing)
    args.removePickable(args.viewer, existing)
  }

  const subset = manager.createSubset({
    modelID: args.modelID,
    ids: idsToShow,
    scene,
    removePrevious: true,
    customID: getSpaceBiasSubsetId(args.modelID)
  }) as Mesh | null

  if (!subset) return

  syncSubsetMatrixFromSources({
    subset,
    baseSubset: args.baseSubsetsRef.current.get(args.modelID) ?? null
  })
  args.tuneSpaceBiasSubsetMesh(subset)
  args.spaceBiasSubsetsRef.current.set(args.modelID, subset)
  args.registerPickable(args.viewer, subset)
}

// Resets applied space-bias state and restores the affected ids back into the base subset.
export const configureSpaceBiasTargets = (args: {
  viewer: IfcViewerAPI
  modelID: number
  baseSubsetsRef: MutableRefObject<Map<number, Mesh>>
  spaceBiasAppliedRef: MutableRefObject<Map<number, Set<number>>>
  spaceBiasIdsRef: MutableRefObject<Map<number, Set<number>>>
  filterIdsRef: MutableRefObject<Map<number, Set<number> | null>>
  ensureBaseSubset: (modelID: number) => Mesh | null
  updateSpaceBiasSubset: (modelID: number, allowedIds: Set<number> | null) => void
}): void => {
  if (!Number.isFinite(args.modelID)) return

  const baseSubset = args.ensureBaseSubset(args.modelID)
  if (!baseSubset) return
  const manager = args.viewer.IFC.loader.ifcManager

  const applied = args.spaceBiasAppliedRef.current.get(args.modelID) ?? new Set<number>()
  const restoreIds = Array.from(applied)
  if (restoreIds.length > 0) {
    const restored = manager.createSubset({
      modelID: args.modelID,
      ids: restoreIds,
      scene: args.viewer.context.getScene(),
      removePrevious: false,
      customID: BASE_SUBSET_ID
    }) as Mesh | null
    if (restored) {
      restored.matrix.copy(baseSubset.matrix)
      restored.matrixAutoUpdate = false
    }
  }

  args.spaceBiasIdsRef.current.delete(args.modelID)
  args.spaceBiasAppliedRef.current.delete(args.modelID)
  const activeFilter = args.filterIdsRef.current.get(args.modelID) ?? null
  args.updateSpaceBiasSubset(args.modelID, activeFilter)
}

// Clears derived subsets, restores original model meshes, and optionally resets the whole custom-object layer.
export const clearOffsetArtifacts = (args: {
  viewer: IfcViewerAPI
  modelID?: number | null
  baseSubsetsRef: MutableRefObject<Map<number, Mesh>>
  spaceBiasSubsetsRef: MutableRefObject<Map<number, Mesh>>
  selectionSubsetsRef: MutableRefObject<Map<number, Mesh>>
  movedSubsetsRef: MutableRefObject<Map<string, Mesh>>
  filterSubsetsRef: MutableRefObject<Map<number, Mesh>>
  filterIdsRef: MutableRefObject<Map<number, Set<number> | null>>
  elementOffsetsRef: MutableRefObject<Map<string, any>>
  elementRotationsRef: MutableRefObject<Map<string, any>>
  hiddenIdsRef: MutableRefObject<Map<number, Set<number>>>
  expressIdCacheRef: MutableRefObject<Map<number, Set<number>>>
  baseCentersRef: MutableRefObject<Map<string, any>>
  placementOriginsRef: MutableRefObject<Map<string, any>>
  coordinationMatrixRef: MutableRefObject<Map<number, any>>
  highlightedIfcRef: MutableRefObject<{ modelID: number; expressID: number } | null>
  spaceBiasIdsRef: MutableRefObject<Map<number, Set<number>>>
  spaceBiasAppliedRef: MutableRefObject<Map<number, Set<number>>>
  registerPickable: (viewer: IfcViewerAPI, mesh: Mesh, modelID?: number) => void
  removePickable: (viewer: IfcViewerAPI, mesh: Mesh) => void
  customObjectRegistryRefs: CustomObjectRegistryRefs
}): void => {
  const manager = args.viewer.IFC.loader.ifcManager
  const scene = args.viewer.context.getScene()
  const derivedIds = collectDerivedModelIds({
    baseSubsets: args.baseSubsetsRef.current,
    spaceBiasSubsets: args.spaceBiasSubsetsRef.current,
    selectionSubsets: args.selectionSubsetsRef.current,
    movedSubsets: args.movedSubsetsRef.current
  })
  const idsToClear = typeof args.modelID === 'number' ? [args.modelID] : derivedIds

  idsToClear.forEach((id) => {
    const filterSubset = args.filterSubsetsRef.current.get(id)
    if (filterSubset) {
      scene.remove(filterSubset)
      args.removePickable(args.viewer, filterSubset)
      manager.removeSubset(id, undefined, getFilterSubsetId(id))
      args.filterSubsetsRef.current.delete(id)
      args.filterIdsRef.current.delete(id)
    }

    const spaceBiasSubset = args.spaceBiasSubsetsRef.current.get(id)
    if (spaceBiasSubset) {
      scene.remove(spaceBiasSubset)
      args.removePickable(args.viewer, spaceBiasSubset)
      manager.removeSubset(id, undefined, getSpaceBiasSubsetId(id))
      args.spaceBiasSubsetsRef.current.delete(id)
    }

    const selectionSubset = args.selectionSubsetsRef.current.get(id)
    if (selectionSubset) {
      scene.remove(selectionSubset)
      manager.removeSubset(id, undefined, getSelectionSubsetId(id))
      args.selectionSubsetsRef.current.delete(id)
    }

    const movedKeys = Array.from(args.movedSubsetsRef.current.keys()).filter((key) =>
      key.startsWith(`${id}:`)
    )
    movedKeys.forEach((key) => {
      removeMovedSubset({
        modelID: id,
        key,
        movedSubset: args.movedSubsetsRef.current.get(key),
        scene,
        manager,
        removePickable: (mesh) => args.removePickable(args.viewer, mesh)
      })
      args.movedSubsetsRef.current.delete(key)
      args.elementOffsetsRef.current.delete(key)
      args.elementRotationsRef.current.delete(key)
    })

    const baseSubset = args.baseSubsetsRef.current.get(id)
    if (baseSubset) {
      scene.remove(baseSubset)
      args.removePickable(args.viewer, baseSubset)
      manager.removeSubset(id, undefined, BASE_SUBSET_ID)
      args.baseSubsetsRef.current.delete(id)
    }

    const model = manager.state?.models?.[id]?.mesh as Mesh | undefined
    if (model) {
      model.visible = true
      args.registerPickable(args.viewer, model, id)
    }
    args.spaceBiasIdsRef.current.delete(id)
    args.spaceBiasAppliedRef.current.delete(id)
    args.hiddenIdsRef.current.delete(id)
    args.expressIdCacheRef.current.delete(id)
    Array.from(args.baseCentersRef.current.keys())
      .filter((key) => key.startsWith(`${id}:`))
      .forEach((key) => args.baseCentersRef.current.delete(key))
    Array.from(args.placementOriginsRef.current.keys())
      .filter((key) => key.startsWith(`${id}:`))
      .forEach((key) => args.placementOriginsRef.current.delete(key))
    args.coordinationMatrixRef.current.delete(id)
    if (args.highlightedIfcRef.current?.modelID === id) {
      args.highlightedIfcRef.current = null
    }
  })

  if (typeof args.modelID !== 'number') {
    clearAllCustomObjects(args.viewer, args.customObjectRegistryRefs, args.removePickable)
    args.baseCentersRef.current.clear()
    args.placementOriginsRef.current.clear()
    args.coordinationMatrixRef.current.clear()
    args.spaceBiasIdsRef.current.clear()
    args.spaceBiasAppliedRef.current.clear()
    args.hiddenIdsRef.current.clear()
    args.elementRotationsRef.current.clear()
    args.selectionSubsetsRef.current.clear()
    args.highlightedIfcRef.current = null
  }
}

// Recomputes the filter subset so only the allowed express ids remain visible on top of moved elements.
export const updateVisibilityForModel = (args: {
  viewer: IfcViewerAPI
  modelID: number
  allowedIds: Set<number> | null
  filterIdsRef: MutableRefObject<Map<number, Set<number> | null>>
  hiddenIdsRef: MutableRefObject<Map<number, Set<number>>>
  filterSubsetsRef: MutableRefObject<Map<number, Mesh>>
  movedSubsetsRef: MutableRefObject<Map<string, Mesh>>
  baseSubsetsRef: MutableRefObject<Map<number, Mesh>>
  ensureBaseSubset: (modelID: number) => Mesh | null
  getMovedIdsForModel: (modelID: number) => Set<number>
  getAllExpressIdsForModel: (modelID: number) => number[]
  updateSpaceBiasSubset: (modelID: number, allowedIds: Set<number> | null) => void
  registerPickable: (viewer: IfcViewerAPI, mesh: Mesh, modelID?: number) => void
  removePickable: (viewer: IfcViewerAPI, mesh: Mesh) => void
}): void => {
  const manager = args.viewer.IFC.loader.ifcManager
  const scene = args.viewer.context.getScene()
  const movedIds = args.getMovedIdsForModel(args.modelID)
  const hiddenIds = args.hiddenIdsRef.current.get(args.modelID) ?? new Set<number>()

  const baseSubset = args.ensureBaseSubset(args.modelID)
  const modelMesh = manager.state?.models?.[args.modelID]?.mesh as Mesh | undefined
  const filterSubset = args.filterSubsetsRef.current.get(args.modelID)

  const effectiveAllowed =
    args.allowedIds === null
      ? hiddenIds.size === 0 && movedIds.size === 0
        ? null
        : new Set(args.getAllExpressIdsForModel(args.modelID).filter((id) => !hiddenIds.has(id)))
      : new Set(Array.from(args.allowedIds).filter((id) => !hiddenIds.has(id)))

  if (!effectiveAllowed) {
    if (filterSubset) {
      scene.remove(filterSubset)
      args.removePickable(args.viewer, filterSubset)
      manager.removeSubset(args.modelID, undefined, getFilterSubsetId(args.modelID))
      args.filterSubsetsRef.current.delete(args.modelID)
    }
    if (baseSubset) {
      baseSubset.visible = true
      args.registerPickable(args.viewer, baseSubset, args.modelID)
    } else if (modelMesh) {
      modelMesh.visible = true
    }
    args.movedSubsetsRef.current.forEach((subset, key) => {
      if (key.startsWith(`${args.modelID}:`)) {
        subset.visible = true
      }
    })
    args.updateSpaceBiasSubset(args.modelID, null)
    return
  }

  if (effectiveAllowed.size === 0) {
    if (filterSubset) {
      scene.remove(filterSubset)
      args.removePickable(args.viewer, filterSubset)
      manager.removeSubset(args.modelID, undefined, getFilterSubsetId(args.modelID))
      args.filterSubsetsRef.current.delete(args.modelID)
    }
    if (baseSubset) {
      baseSubset.visible = false
    } else if (modelMesh) {
      modelMesh.visible = false
    }
    args.movedSubsetsRef.current.forEach((subset, key) => {
      if (key.startsWith(`${args.modelID}:`)) {
        subset.visible = false
      }
    })
    args.updateSpaceBiasSubset(args.modelID, effectiveAllowed)
    return
  }

  if (baseSubset) {
    baseSubset.visible = false
  } else if (modelMesh) {
    modelMesh.visible = false
  }

  args.movedSubsetsRef.current.forEach((subset, key) => {
    if (!key.startsWith(`${args.modelID}:`)) return
    const expressId = Number(key.split(':')[1])
    if (Number.isFinite(expressId)) {
      subset.visible = effectiveAllowed.has(expressId)
    }
  })

  const idsToShow = Array.from(effectiveAllowed).filter((id) => !movedIds.has(id))
  if (idsToShow.length === 0) {
    if (filterSubset) {
      scene.remove(filterSubset)
      args.removePickable(args.viewer, filterSubset)
      manager.removeSubset(args.modelID, undefined, getFilterSubsetId(args.modelID))
      args.filterSubsetsRef.current.delete(args.modelID)
    }
    args.updateSpaceBiasSubset(args.modelID, effectiveAllowed)
    return
  }

  const subset = manager.createSubset({
    modelID: args.modelID,
    ids: idsToShow,
    scene,
    removePrevious: true,
    customID: getFilterSubsetId(args.modelID)
  }) as Mesh | null
  if (subset) {
    syncSubsetMatrixFromSources({
      subset,
      baseSubset: baseSubset ?? null
    })
    args.filterSubsetsRef.current.set(args.modelID, subset)
    args.registerPickable(args.viewer, subset, args.modelID)
  }
  args.updateSpaceBiasSubset(args.modelID, effectiveAllowed)
}
