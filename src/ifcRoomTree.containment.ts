import type { ObjectTree } from './ifcViewerTypes'
import {
  resolveContainedSpaceId,
  resolveContainedSpaceIdFromRelation
} from './ifcViewer.utils'
import type { IfcViewerAPI } from './viewer/IfcViewerAPICompat'
import { IFC_SPATIAL_TYPES } from './ifcRoomTree.constants'

// Collects non-spatial IFC element ids that are eligible for room-containment regrouping.
export const collectContainmentCandidateIds = (tree: ObjectTree): number[] => {
  const ids = new Set<number>()
  const stack: string[] = []
  Object.values(tree.nodes).forEach((node) => {
    if (node.nodeType !== 'ifc') return
    if (node.type.toUpperCase() !== 'IFCBUILDINGSTOREY') return
    stack.push(...node.children)
  })

  const visited = new Set<string>()
  while (stack.length > 0) {
    const nodeId = stack.pop()
    if (!nodeId || visited.has(nodeId)) continue
    visited.add(nodeId)

    const node = tree.nodes[nodeId]
    if (!node) continue
    if (node.children.length > 0) {
      stack.push(...node.children)
    }
    if (node.nodeType !== 'ifc' || node.expressID === null) continue

    const type = node.type.toUpperCase()
    if (IFC_SPATIAL_TYPES.has(type) || type.startsWith('IFCREL')) continue
    ids.add(node.expressID)
  }

  if (ids.size === 0) {
    Object.values(tree.nodes).forEach((node) => {
      if (node.nodeType !== 'ifc' || node.expressID === null) return
      const type = node.type.toUpperCase()
      if (IFC_SPATIAL_TYPES.has(type) || type.startsWith('IFCREL')) return
      const parent = node.parentId ? tree.nodes[node.parentId] : null
      const parentType = parent?.type?.toUpperCase?.() ?? ''
      if (parentType === 'IFCBUILDINGSTOREY' || parentType === 'IFCSPACE' || parentType === 'UNKNOWN') {
        ids.add(node.expressID)
      }
    })
  }

  return Array.from(ids)
}

// Resolves the IFC space id referenced by one containment relation element.
export const resolveSpaceFromRelationId = async (
  viewer: IfcViewerAPI,
  modelID: number,
  relationExpressId: number
): Promise<number | null> => {
  try {
    const relationProperties = await viewer.IFC.getProperties(modelID, relationExpressId, false, false)
    if (!relationProperties) return null
    const spaceFromRelation = resolveContainedSpaceIdFromRelation(relationProperties)
    if (spaceFromRelation !== null) {
      return spaceFromRelation
    }
    return resolveContainedSpaceId(relationProperties)
  } catch {
    return null
  }
}
