import { useCallback } from 'react'
import { Mesh } from 'three'
import type { IfcViewerAPI } from '../viewer/IfcViewerAPICompat'
import { clearCustomObjectsOnly as clearCustomObjectsOnlyInternal, clearOffsetArtifacts as clearOffsetArtifactsInternal, configureSpaceBiasTargets as configureSpaceBiasTargetsInternal, ensureBaseSubset as ensureBaseSubsetInternal, updateSpaceBiasSubset as updateSpaceBiasSubsetInternal, updateVisibilityForModel as updateVisibilityForModelInternal } from './selectionOffsets.subsetState'
import { getMovedIdsForModel as getMovedIdsForModelFromSubsets, removeMovedSubset } from './selectionOffsets.subsets'
import type { SelectionOffsetRefs } from './useSelectionOffsetRefs'

type UseSelectionOffsetsVisibilityArgs = {
  viewerRef: { current: IfcViewerAPI | null }
  refs: SelectionOffsetRefs
  getElementKey: (modelID: number, expressID: number) => string
  clearIfcSelectionHighlight: (modelID?: number | null) => void
}

type UseSelectionOffsetsVisibilityResult = {
  removePickable: (viewer: IfcViewerAPI, mesh: Mesh) => void
  registerPickable: (viewer: IfcViewerAPI, mesh: Mesh, slot?: number) => void
  getAllExpressIdsForModel: (modelID: number) => number[]
  hasRenderableExpressId: (modelID: number, expressID: number) => boolean
  ensureBaseSubset: (modelID: number) => Mesh | null
  configureSpaceBiasTargets: (modelID: number, expressIDs: number[]) => void
  clearCustomObjects: () => void
  clearOffsetArtifacts: (modelID?: number | null) => void
  updateVisibilityForModel: (modelID: number, allowedIds: Set<number> | null) => void
  applyVisibilityFilter: (modelID: number, visibleIds: number[] | null) => void
  hideIfcElement: (modelID: number, expressID: number) => void
}

// Builds the visibility and subset callbacks used by the selection-offset hook.
export const useSelectionOffsetsVisibility = (
  args: UseSelectionOffsetsVisibilityArgs
): UseSelectionOffsetsVisibilityResult => {
  // This function removes every occurrence of one mesh from the viewer pickable collection.
  const removePickable = useCallback((viewer: IfcViewerAPI, mesh: Mesh) => {
    const pickables = viewer.context.items.pickableIfcModels
    for (let index = pickables.length - 1; index >= 0; index -= 1) {
      if (pickables[index] === (mesh as any)) {
        pickables.splice(index, 1)
      }
    }
  }, [])

  // This function compacts the pickable collection and appends one mesh only when it is not already present.
  const registerPickable = useCallback(
    (viewer: IfcViewerAPI, mesh: Mesh, _slot?: number) => {
      const pickables = viewer.context.items.pickableIfcModels
      for (let index = pickables.length - 1; index >= 0; index -= 1) {
        if (!pickables[index]) {
          pickables.splice(index, 1)
        }
      }
      if (!pickables.includes(mesh as any)) {
        pickables.push(mesh as any)
      }
    },
    []
  )

  // This function caches the renderable express ids present in one IFC model geometry.
  const getExpressIdSet = useCallback(
    (modelID: number) => {
      const cached = args.refs.expressIdCacheRef.current.get(modelID)
      if (cached && cached.size > 0) return cached

      const viewer = args.viewerRef.current
      const model = viewer?.IFC.loader.ifcManager.state?.models?.[modelID]?.mesh as Mesh | undefined
      const expressAttr = model?.geometry.getAttribute('expressID')
      if (!expressAttr || !('array' in expressAttr)) {
        return cached ?? new Set<number>()
      }

      const uniqueIds = new Set<number>()
      Array.from((expressAttr as { array: ArrayLike<number> }).array).forEach((rawId) => {
        if (typeof rawId === 'number') {
          uniqueIds.add(Math.trunc(rawId))
        }
      })

      if (uniqueIds.size > 0 || !cached) {
        args.refs.expressIdCacheRef.current.set(modelID, uniqueIds)
      }
      return uniqueIds
    },
    [args.refs.expressIdCacheRef, args.viewerRef]
  )

  // This function returns every renderable express id currently available in one IFC model.
  const getAllExpressIdsForModel = useCallback(
    (modelID: number) => {
      const ids = getExpressIdSet(modelID)
      return ids.size > 0 ? Array.from(ids) : []
    },
    [getExpressIdSet]
  )

  // This function checks whether one IFC express id is still renderable in the current model geometry.
  const hasRenderableExpressId = useCallback(
    (modelID: number, expressID: number) => {
      return getExpressIdSet(modelID).has(expressID)
    },
    [getExpressIdSet]
  )

  // This function creates or reuses the hidden base subset that hosts IFC transform edits.
  const ensureBaseSubset = useCallback(
    (modelID: number) => {
      const viewer = args.viewerRef.current
      if (!viewer) return null
      return ensureBaseSubsetInternal({
        viewer,
        modelID,
        baseSubsetsRef: args.refs.baseSubsetsRef,
        getAllExpressIdsForModel,
        registerPickable
      })
    },
    [args.refs.baseSubsetsRef, args.viewerRef, getAllExpressIdsForModel, registerPickable]
  )

  // This function returns the express ids that currently live in moved subsets for one IFC model.
  const getMovedIdsForModel = useCallback((modelID: number) => {
    return getMovedIdsForModelFromSubsets(args.refs.movedSubsetsRef.current, modelID)
  }, [args.refs.movedSubsetsRef])

  // This function rebuilds the optional space-bias subset for the current room-based visibility state.
  const updateSpaceBiasSubset = useCallback(
    (modelID: number, allowedIds: Set<number> | null) => {
      const viewer = args.viewerRef.current
      if (!viewer) return
      updateSpaceBiasSubsetInternal({
        viewer,
        modelID,
        allowedIds,
        baseSubsetsRef: args.refs.baseSubsetsRef,
        spaceBiasSubsetsRef: args.refs.spaceBiasSubsetsRef,
        spaceBiasIdsRef: args.refs.spaceBiasIdsRef,
        getMovedIdsForModel,
        registerPickable,
        removePickable
      })
    },
    [
      args.refs.baseSubsetsRef,
      args.refs.spaceBiasIdsRef,
      args.refs.spaceBiasSubsetsRef,
      args.viewerRef,
      getMovedIdsForModel,
      registerPickable,
      removePickable
    ]
  )

  // This function resets and reapplies the room-related space-bias visibility targets for one IFC model.
  const configureSpaceBiasTargets = useCallback(
    (modelID: number, _expressIDs: number[]) => {
      const viewer = args.viewerRef.current
      if (!viewer) return
      configureSpaceBiasTargetsInternal({
        viewer,
        modelID,
        baseSubsetsRef: args.refs.baseSubsetsRef,
        spaceBiasAppliedRef: args.refs.spaceBiasAppliedRef,
        spaceBiasIdsRef: args.refs.spaceBiasIdsRef,
        filterIdsRef: args.refs.filterIdsRef,
        ensureBaseSubset,
        updateSpaceBiasSubset
      })
    },
    [
      args.refs.baseSubsetsRef,
      args.refs.filterIdsRef,
      args.refs.spaceBiasAppliedRef,
      args.refs.spaceBiasIdsRef,
      args.viewerRef,
      ensureBaseSubset,
      updateSpaceBiasSubset
    ]
  )

  // This function clears all derived subsets, offsets, and cached placement state for one model or the whole viewer.
  const clearOffsetArtifacts = useCallback(
    (modelID?: number | null) => {
      const viewer = args.viewerRef.current
      if (!viewer) return
      clearOffsetArtifactsInternal({
        viewer,
        modelID,
        baseSubsetsRef: args.refs.baseSubsetsRef,
        spaceBiasSubsetsRef: args.refs.spaceBiasSubsetsRef,
        selectionSubsetsRef: args.refs.selectionSubsetsRef,
        movedSubsetsRef: args.refs.movedSubsetsRef,
        filterSubsetsRef: args.refs.filterSubsetsRef,
        filterIdsRef: args.refs.filterIdsRef,
        elementOffsetsRef: args.refs.elementOffsetsRef,
        elementRotationsRef: args.refs.elementRotationsRef,
        hiddenIdsRef: args.refs.hiddenIdsRef,
        expressIdCacheRef: args.refs.expressIdCacheRef,
        baseCentersRef: args.refs.baseCentersRef,
        placementOriginsRef: args.refs.placementOriginsRef,
        coordinationMatrixRef: args.refs.coordinationMatrixRef,
        highlightedIfcRef: args.refs.highlightedIfcRef,
        spaceBiasIdsRef: args.refs.spaceBiasIdsRef,
        spaceBiasAppliedRef: args.refs.spaceBiasAppliedRef,
        registerPickable,
        removePickable,
        customObjectRegistryRefs: args.refs.customObjectRegistryRefs
      })
    },
    [args.refs, args.viewerRef, registerPickable, removePickable]
  )

  // This function clears only the temporary custom-object layer while leaving IFC subset state intact.
  const clearCustomObjects = useCallback(() => {
    const viewer = args.viewerRef.current
    if (!viewer) return
    clearCustomObjectsOnlyInternal({
      viewer,
      customObjectRegistryRefs: args.refs.customObjectRegistryRefs,
      removePickable
    })
  }, [args.refs.customObjectRegistryRefs, args.viewerRef, removePickable])

  // This function rebuilds the filter subset so only the allowed IFC ids remain visible.
  const updateVisibilityForModel = useCallback(
    (modelID: number, allowedIds: Set<number> | null) => {
      const viewer = args.viewerRef.current
      if (!viewer) return
      updateVisibilityForModelInternal({
        viewer,
        modelID,
        allowedIds,
        filterIdsRef: args.refs.filterIdsRef,
        hiddenIdsRef: args.refs.hiddenIdsRef,
        filterSubsetsRef: args.refs.filterSubsetsRef,
        movedSubsetsRef: args.refs.movedSubsetsRef,
        baseSubsetsRef: args.refs.baseSubsetsRef,
        ensureBaseSubset,
        getMovedIdsForModel,
        getAllExpressIdsForModel,
        updateSpaceBiasSubset,
        registerPickable,
        removePickable
      })
    },
    [
      args.refs.baseSubsetsRef,
      args.refs.filterIdsRef,
      args.refs.filterSubsetsRef,
      args.refs.hiddenIdsRef,
      args.refs.movedSubsetsRef,
      args.viewerRef,
      ensureBaseSubset,
      getAllExpressIdsForModel,
      getMovedIdsForModel,
      registerPickable,
      removePickable,
      updateSpaceBiasSubset
    ]
  )

  // This function applies a visibility whitelist by converting it into the subset state used by the viewer.
  const applyVisibilityFilter = useCallback(
    (modelID: number, visibleIds: number[] | null) => {
      const allowed =
        visibleIds === null ? null : new Set(visibleIds.filter(Number.isFinite))
      args.refs.filterIdsRef.current.set(modelID, allowed)
      updateVisibilityForModel(modelID, allowed)
    },
    [args.refs.filterIdsRef, updateVisibilityForModel]
  )

  // This function soft-hides one IFC element by removing its moved subset and excluding it from visibility filters.
  const hideIfcElement = useCallback(
    (modelID: number, expressID: number) => {
      const viewer = args.viewerRef.current
      if (!viewer) return
      ensureBaseSubset(modelID)
      const manager = viewer.IFC.loader.ifcManager
      const scene = viewer.context.getScene()
      const key = args.getElementKey(modelID, expressID)

      let hidden = args.refs.hiddenIdsRef.current.get(modelID)
      if (!hidden) {
        hidden = new Set<number>()
        args.refs.hiddenIdsRef.current.set(modelID, hidden)
      }
      hidden.add(expressID)

      removeMovedSubset({
        modelID,
        key,
        movedSubset: args.refs.movedSubsetsRef.current.get(key),
        scene,
        manager,
        removePickable: (mesh) => removePickable(viewer, mesh)
      })
      args.refs.movedSubsetsRef.current.delete(key)
      args.refs.elementOffsetsRef.current.delete(key)
      args.refs.elementRotationsRef.current.delete(key)
      args.refs.spaceBiasIdsRef.current.get(modelID)?.delete(expressID)
      args.refs.spaceBiasAppliedRef.current.get(modelID)?.delete(expressID)
      const activeFilter = args.refs.filterIdsRef.current.get(modelID) ?? null
      updateVisibilityForModel(modelID, activeFilter)
      const activeHighlight = args.refs.highlightedIfcRef.current
      if (activeHighlight && activeHighlight.modelID === modelID && activeHighlight.expressID === expressID) {
        args.clearIfcSelectionHighlight(modelID)
      }
    },
    [args.clearIfcSelectionHighlight, args.getElementKey, args.refs, args.viewerRef, ensureBaseSubset, removePickable, updateVisibilityForModel]
  )

  return {
    removePickable,
    registerPickable,
    getAllExpressIdsForModel,
    hasRenderableExpressId,
    ensureBaseSubset,
    configureSpaceBiasTargets,
    clearCustomObjects,
    clearOffsetArtifacts,
    updateVisibilityForModel,
    applyVisibilityFilter,
    hideIfcElement
  }
}
