import {
  CONTAINMENT_RELATION_BATCH_SIZE,
  MAX_CONTAINMENT_RELATION_LOOKUPS
} from './ifcViewer.constants'
import type { ObjectTree } from './ifcViewerTypes'
import {
  collectContainmentCandidateIds,
  resolveSpaceFromRelationId
} from './ifcRoomTree.utils'
import {
  collectContainedRelationIds,
  resolveContainedSpaceId
} from './ifcViewer.utils'
import type { TreeHydrationTaskArgs } from './ifcViewer.treeHydration.types'
import { isCurrentTreeLoad } from './ifcViewer.treeHydration.shared'

// Builds a map of element-to-space containment relations from IFC properties and containment links.
export const buildSpatialContainmentMap = async (
  args: TreeHydrationTaskArgs & { tree: ObjectTree }
): Promise<Map<number, number>> => {
  const { viewer, tree, modelID, loadToken, isLoadTokenCurrent } = args
  const spaceIds = new Set<number>()
  Object.values(tree.nodes).forEach((node) => {
    if (node.nodeType !== 'ifc' || node.expressID === null) return
    if (node.type.toUpperCase() === 'IFCSPACE') {
      spaceIds.add(node.expressID)
    }
  })
  if (spaceIds.size === 0) return new Map()

  const candidates = collectContainmentCandidateIds(tree)
  if (candidates.length === 0) return new Map()
  const lookupIds =
    candidates.length > MAX_CONTAINMENT_RELATION_LOOKUPS
      ? candidates.slice(0, MAX_CONTAINMENT_RELATION_LOOKUPS)
      : candidates

  if (lookupIds.length < candidates.length) {
    console.warn(
      `Containment lookup limited to ${MAX_CONTAINMENT_RELATION_LOOKUPS} of ${candidates.length} IFC nodes.`
    )
  }

  const map = new Map<number, number>()
  const relationSpaceCache = new Map<number, number | null>()
  for (let index = 0; index < lookupIds.length; index += CONTAINMENT_RELATION_BATCH_SIZE) {
    if (!isCurrentTreeLoad(loadToken, isLoadTokenCurrent)) {
      return map
    }

    const batch = lookupIds.slice(index, index + CONTAINMENT_RELATION_BATCH_SIZE)
    const entries = await Promise.all(
      batch.map(async (expressID) => {
        try {
          const properties = await viewer.IFC.getProperties(modelID, expressID, false, true)
          let spaceId = resolveContainedSpaceId(properties)

          if (spaceId === null) {
            const relationIds = collectContainedRelationIds(properties)
            for (const relationId of relationIds) {
              let cachedSpace = relationSpaceCache.get(relationId)
              if (cachedSpace === undefined) {
                cachedSpace = await resolveSpaceFromRelationId(viewer, modelID, relationId)
                relationSpaceCache.set(relationId, cachedSpace)
              }
              if (cachedSpace !== null && spaceIds.has(cachedSpace)) {
                spaceId = cachedSpace
                break
              }
            }
          }

          if (spaceId === null || !spaceIds.has(spaceId)) return null
          return [expressID, spaceId] as const
        } catch (err) {
          console.warn('Failed to resolve IfcRelContainedInSpatialStructure for', expressID, err)
          return null
        }
      })
    )

    entries.forEach((entry) => {
      if (!entry) return
      map.set(entry[0], entry[1])
    })
  }

  return map
}
