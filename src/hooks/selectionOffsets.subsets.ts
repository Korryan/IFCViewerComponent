import type { MutableRefObject } from 'react'
import { DoubleSide, Mesh, MeshStandardMaterial } from 'three'
import {
  BASE_SUBSET_ID,
  FILTER_SUBSET_PREFIX,
  IFC_SELECTION_COLOR,
  IFC_SELECTION_EMISSIVE,
  MOVED_SUBSET_PREFIX,
  SELECTION_SUBSET_PREFIX,
  SPACE_BIAS_SUBSET_PREFIX
} from './selectionOffsets.shared'

// Builds the subset id used for temporary selection highlight meshes.
export const getSelectionSubsetId = (modelID: number) => `${SELECTION_SUBSET_PREFIX}${modelID}`

// Builds the subset id used for visibility-filter meshes.
export const getFilterSubsetId = (modelID: number) => `${FILTER_SUBSET_PREFIX}${modelID}`

// Builds the subset id used for the room-space bias overlay meshes.
export const getSpaceBiasSubsetId = (modelID: number) => `${SPACE_BIAS_SUBSET_PREFIX}${modelID}`

// Returns the shared material instance used by IFC selection highlight subsets.
export const getOrCreateSelectionMaterial = (
  selectionMaterialRef: MutableRefObject<MeshStandardMaterial | null>
) => {
  if (!selectionMaterialRef.current) {
    selectionMaterialRef.current = new MeshStandardMaterial({
      color: IFC_SELECTION_COLOR,
      emissive: IFC_SELECTION_EMISSIVE,
      side: DoubleSide,
      roughness: 0.45,
      metalness: 0,
      transparent: true,
      opacity: 0.45,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2
    })
  }
  return selectionMaterialRef.current
}

// Collects the express ids that currently have moved subsets for one model.
export const getMovedIdsForModel = (movedSubsets: Map<string, Mesh>, modelID: number) => {
  const movedIds = new Set<number>()
  movedSubsets.forEach((_subset, key) => {
    if (!key.startsWith(`${modelID}:`)) return
    const expressId = Number(key.split(':')[1])
    if (Number.isFinite(expressId)) {
      movedIds.add(expressId)
    }
  })
  return movedIds
}

// Collects every model id that currently owns any derived subset in the scene.
export const collectDerivedModelIds = (args: {
  baseSubsets: Map<number, Mesh>
  spaceBiasSubsets: Map<number, Mesh>
  selectionSubsets: Map<number, Mesh>
  movedSubsets: Map<string, Mesh>
}) =>
  Array.from(
    new Set([
      ...args.baseSubsets.keys(),
      ...args.spaceBiasSubsets.keys(),
      ...args.selectionSubsets.keys(),
      ...Array.from(args.movedSubsets.keys())
        .map((key) => Number(key.split(':')[0]))
        .filter((id) => Number.isFinite(id))
    ])
  )

// Copies the best available base transform onto a derived subset so it stays aligned with the model.
export const syncSubsetMatrixFromSources = (args: {
  subset: Mesh
  movedSubset?: Mesh | null
  baseSubset?: Mesh | null
  modelMesh?: Mesh | null
}) => {
  const { subset, movedSubset, baseSubset, modelMesh } = args
  if (movedSubset) {
    subset.matrix.copy(movedSubset.matrix)
    subset.matrixAutoUpdate = false
    return
  }
  if (baseSubset) {
    subset.matrix.copy(baseSubset.matrix)
    subset.matrixAutoUpdate = false
    return
  }
  if (modelMesh) {
    subset.matrix.copy(modelMesh.matrix)
    subset.matrixAutoUpdate = false
    return
  }
}

// Removes one moved subset instance and clears its manager-side subset entry.
export const removeMovedSubset = (args: {
  modelID: number
  key: string
  movedSubset: Mesh | null | undefined
  scene: { remove: (object: Mesh) => void }
  manager: { removeSubset: (modelID: number, material?: unknown, customID?: string) => void }
  removePickable: (mesh: Mesh) => void
}) => {
  if (args.movedSubset) {
    args.scene.remove(args.movedSubset)
    args.removePickable(args.movedSubset)
    args.manager.removeSubset(args.modelID, undefined, `${MOVED_SUBSET_PREFIX}${args.key}`)
  }
}

export { BASE_SUBSET_ID, MOVED_SUBSET_PREFIX }
