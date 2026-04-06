import type { MutableRefObject } from 'react'
import type { Mesh, MeshStandardMaterial } from 'three'
import type { IfcViewerAPI } from '../viewer/IfcViewerAPICompat'
import { normalizeIfcIds } from './selectionOffsets.shared'
import {
  getOrCreateSelectionMaterial,
  getSelectionSubsetId,
  syncSubsetMatrixFromSources
} from './selectionOffsets.subsets'

type HighlightSelectionArgs = {
  viewer: IfcViewerAPI | null
  selectionSubsetsRef: MutableRefObject<Map<number, Mesh>>
  highlightedIfcRef: MutableRefObject<{ modelID: number; expressID: number } | null>
}

type HighlightSelectionSetArgs = HighlightSelectionArgs & {
  modelID: number
  expressIDs: number[]
  anchorExpressID?: number | null
  selectionMaterialRef: MutableRefObject<MeshStandardMaterial | null>
  movedSubsetsRef: MutableRefObject<Map<string, Mesh>>
  baseSubsetsRef: MutableRefObject<Map<number, Mesh>>
  getElementKey: (modelID: number, expressID: number) => string
  hasRenderableExpressId: (modelID: number, expressID: number) => boolean
}

// Removes the active IFC highlight subset for one model or for every highlighted model.
export const clearIfcSelectionHighlightState = (
  args: HighlightSelectionArgs & {
    modelID?: number | null
  }
) => {
  const idsToClear =
    typeof args.modelID === 'number'
      ? [args.modelID]
      : Array.from(args.selectionSubsetsRef.current.keys())

  if (!args.viewer) {
    idsToClear.forEach((id) => args.selectionSubsetsRef.current.delete(id))
    if (typeof args.modelID !== 'number' || args.highlightedIfcRef.current?.modelID === args.modelID) {
      args.highlightedIfcRef.current = null
    }
    return
  }

  const manager = args.viewer.IFC.loader.ifcManager
  const scene = args.viewer.context.getScene()
  idsToClear.forEach((id) => {
    const subset = args.selectionSubsetsRef.current.get(id)
    if (subset) {
      scene.remove(subset)
      args.selectionSubsetsRef.current.delete(id)
    }
    manager.removeSubset(id, undefined, getSelectionSubsetId(id))
  })
  if (typeof args.modelID !== 'number' || args.highlightedIfcRef.current?.modelID === args.modelID) {
    args.highlightedIfcRef.current = null
  }
}

// Builds or refreshes the highlight subset for the requested IFC ids in one model.
export const applyIfcSelectionHighlightSet = (
  args: HighlightSelectionSetArgs
) => {
  if (!args.viewer) return

  const renderableIds = normalizeIfcIds(args.expressIDs).filter((id) =>
    args.hasRenderableExpressId(args.modelID, id)
  )
  if (renderableIds.length === 0) {
    clearIfcSelectionHighlightState(args)
    return
  }

  const primaryExpressID =
    typeof args.anchorExpressID === 'number' && Number.isFinite(args.anchorExpressID)
      ? Math.trunc(args.anchorExpressID)
      : renderableIds[0]

  const previous = args.highlightedIfcRef.current
  if (
    previous &&
    (previous.modelID !== args.modelID || !renderableIds.includes(previous.expressID))
  ) {
    clearIfcSelectionHighlightState({
      viewer: args.viewer,
      modelID: previous.modelID,
      selectionSubsetsRef: args.selectionSubsetsRef,
      highlightedIfcRef: args.highlightedIfcRef
    })
  }

  const manager = args.viewer.IFC.loader.ifcManager
  const scene = args.viewer.context.getScene()
  const subset = manager.createSubset({
    modelID: args.modelID,
    ids: renderableIds,
    scene,
    removePrevious: true,
    material: getOrCreateSelectionMaterial(args.selectionMaterialRef),
    customID: getSelectionSubsetId(args.modelID)
  }) as Mesh | null

  if (!subset) {
    clearIfcSelectionHighlightState(args)
    return
  }

  const key = args.getElementKey(args.modelID, primaryExpressID)
  syncSubsetMatrixFromSources({
    subset,
    movedSubset: args.movedSubsetsRef.current.get(key),
    baseSubset: args.baseSubsetsRef.current.get(args.modelID) ?? null,
    modelMesh: (manager.state?.models?.[args.modelID]?.mesh as Mesh | undefined) ?? null
  })

  subset.renderOrder = 10
  args.selectionSubsetsRef.current.set(args.modelID, subset)
  args.highlightedIfcRef.current = { modelID: args.modelID, expressID: primaryExpressID }
}

// Highlights a single IFC element by delegating to the shared subset highlight path.
export const applyIfcSelectionHighlight = (
  args: Omit<HighlightSelectionSetArgs, 'expressIDs' | 'anchorExpressID'> & {
    expressID: number
  }
) => {
  applyIfcSelectionHighlightSet({
    ...args,
    expressIDs: [args.expressID],
    anchorExpressID: args.expressID
  })
}

// Highlights a group of IFC ids while keeping one optional express id as the active anchor.
export const highlightIfcGroup = (
  args: HighlightSelectionSetArgs
) => {
  applyIfcSelectionHighlightSet(args)
}
