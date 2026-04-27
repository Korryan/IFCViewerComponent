import {
  MAX_UNKNOWN_TREE_TYPE_LOOKUPS,
  UNKNOWN_TREE_TYPE_BATCH_SIZE
} from './ifcViewer.constants'
import type { ObjectTree } from './ifcViewerTypes'
import {
  normalizeIfcTypeValue,
  resolveIfcTypeFromProperties
} from './ifcViewer.utils'
import { localizeIfcType } from './utils/ifcTypeLocalization'
import type { TreeHydrationTaskArgs } from './ifcViewer.treeHydration.types'
import { isCurrentTreeLoad } from './ifcViewer.treeHydration.shared'

// Resolves a concrete IFC type for one express id using the fastest available source first.
const resolveIfcNodeType = async (
  viewer: TreeHydrationTaskArgs['viewer'],
  modelID: number,
  expressID: number
): Promise<string | null> => {
  try {
    const manager = viewer.IFC?.loader?.ifcManager as
      | { getIfcType?: (modelID: number, id: number) => string | undefined }
      | undefined
    const directType = manager?.getIfcType?.(modelID, expressID)
    const normalizedDirect = normalizeIfcTypeValue(directType)
    if (normalizedDirect) {
      return normalizedDirect
    }
  } catch {
    // Fallback to property read below.
  }

  try {
    const props = await viewer.IFC.getProperties(modelID, expressID, false, false)
    return resolveIfcTypeFromProperties(props)
  } catch {
    return null
  }
}

// Fills UNKNOWN IFC nodes with resolved labels in small batches so the UI remains responsive.
export const hydrateUnknownIfcNodeTypes = async (
  args: TreeHydrationTaskArgs & { tree: ObjectTree }
): Promise<ObjectTree> => {
  const { viewer, tree, modelID, loadToken, isLoadTokenCurrent } = args
  const unknownNodes = Object.values(tree.nodes).filter(
    (node) => node.nodeType === 'ifc' && node.expressID !== null && node.type.toUpperCase() === 'UNKNOWN'
  )
  if (unknownNodes.length === 0) return tree

  const lookupNodes =
    unknownNodes.length > MAX_UNKNOWN_TREE_TYPE_LOOKUPS
      ? unknownNodes.slice(0, MAX_UNKNOWN_TREE_TYPE_LOOKUPS)
      : unknownNodes

  if (lookupNodes.length < unknownNodes.length) {
    console.warn(
      `Type lookup limited to ${MAX_UNKNOWN_TREE_TYPE_LOOKUPS} of ${unknownNodes.length} IFC nodes.`
    )
  }

  const updates = new Map<string, string>()
  for (let index = 0; index < lookupNodes.length; index += UNKNOWN_TREE_TYPE_BATCH_SIZE) {
    if (!isCurrentTreeLoad(loadToken, isLoadTokenCurrent)) {
      return tree
    }

    const batch = lookupNodes.slice(index, index + UNKNOWN_TREE_TYPE_BATCH_SIZE)
    const resolved = await Promise.all(
      batch.map(async (node) => {
        const expressID = node.expressID
        if (expressID === null) return null
        const resolvedType = await resolveIfcNodeType(viewer, modelID, expressID)
        if (!resolvedType || resolvedType === 'UNKNOWN') return null
        return { nodeId: node.id, type: resolvedType }
      })
    )

    resolved.forEach((entry) => {
      if (!entry) return
      updates.set(entry.nodeId, entry.type)
    })
  }

  if (updates.size === 0) return tree

  const nextNodes: ObjectTree['nodes'] = { ...tree.nodes }
  updates.forEach((resolvedType, nodeId) => {
    const node = nextNodes[nodeId]
    if (!node) return
    nextNodes[nodeId] = {
      ...node,
      type: resolvedType,
      label: localizeIfcType(resolvedType)
    }
  })

  return {
    nodes: nextNodes,
    roots: tree.roots
  }
}
