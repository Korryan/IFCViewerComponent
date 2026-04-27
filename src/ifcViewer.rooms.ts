import type { ObjectTree, ObjectTreeNode } from './ifcViewerTypes'
import type { StoreyInfo } from './ifcRoomTree.utils'

export type RoomListEntry = {
  nodeId: string
  label: string
  ifcId: number
  roomNumber?: string | null
  storeyId?: string | null
  storeyLabel?: string | null
  storeyElevation?: number | null
}

// This normalizes IFC type names so room and storey lookups stay stable across sources.
const normalizeIfcType = (type?: string): string => (type ?? '').trim().toUpperCase()

// This checks whether a tree node represents one specific IFC class.
const isIfcType = (node: ObjectTreeNode | undefined, target: string): boolean =>
  Boolean(node && node.nodeType === 'ifc' && normalizeIfcType(node.type) === target)

// This walks the tree once to preserve the visual order of building storeys.
const collectStoreyOrder = (tree: ObjectTree): string[] => {
  const order: string[] = []
  const visitNode = (nodeId: string) => {
    const node = tree.nodes[nodeId]
    if (!node) return
    if (isIfcType(node, 'IFCBUILDINGSTOREY')) {
      order.push(nodeId)
    }
    node.children.forEach(visitNode)
  }
  tree.roots.forEach(visitNode)
  return order
}

// This derives deterministic room-list labels and elevations for each storey in the tree.
const buildStoreyPresentation = (
  tree: ObjectTree,
  storeyInfoByNodeId: Record<string, StoreyInfo>
): {
  treeIndexByStoreyId: Map<string, number>
  storeyLabelById: Map<string, string>
  storeyElevationById: Map<string, number | null>
} => {
  const storeyOrder = collectStoreyOrder(tree)
  const treeIndexByStoreyId = new Map<string, number>()
  storeyOrder.forEach((storeyId, index) => {
    treeIndexByStoreyId.set(storeyId, index)
  })

  const sortedStoreys = storeyOrder
    .map((storeyId) => ({
      id: storeyId,
      treeIndex: treeIndexByStoreyId.get(storeyId) ?? Number.MAX_SAFE_INTEGER,
      elevation:
        typeof storeyInfoByNodeId[storeyId]?.elevation === 'number'
          ? storeyInfoByNodeId[storeyId].elevation
          : null
    }))
    .sort((left, right) => {
      const leftHasElevation = typeof left.elevation === 'number'
      const rightHasElevation = typeof right.elevation === 'number'
      if (leftHasElevation && rightHasElevation && left.elevation !== right.elevation) {
        return (left.elevation ?? 0) - (right.elevation ?? 0)
      }
      if (leftHasElevation !== rightHasElevation) {
        return leftHasElevation ? -1 : 1
      }
      return left.treeIndex - right.treeIndex
    })

  const storeyLabelById = new Map<string, string>()
  const storeyElevationById = new Map<string, number | null>()
  sortedStoreys.forEach((storey, index) => {
    storeyElevationById.set(storey.id, storey.elevation)
    storeyLabelById.set(storey.id, `Podlazi ${index + 1}`)
  })

  return {
    treeIndexByStoreyId,
    storeyLabelById,
    storeyElevationById
  }
}

// This resolves the nearest parent storey for one node so rooms can be grouped by floor.
const resolveStoreyForNode = (
  tree: ObjectTree,
  nodeId: string,
  storeyLabelById: Map<string, string>,
  storeyElevationById: Map<string, number | null>
): { id: string | null; label: string | null; elevation: number | null } => {
  let currentId: string | null = nodeId
  while (currentId) {
    const node: ObjectTree['nodes'][string] | undefined = tree.nodes[currentId]
    if (!node) break
    if (isIfcType(node, 'IFCBUILDINGSTOREY')) {
      return {
        id: node.id,
        label: storeyLabelById.get(node.id) ?? node.name?.trim() ?? node.label,
        elevation: storeyElevationById.get(node.id) ?? null
      }
    }
    currentId = node.parentId
  }
  return { id: null, label: 'Nezarazene', elevation: null }
}

// This builds the room sidebar data directly from the tree and room-number lookup map.
export const buildRoomOptions = (args: {
  tree: ObjectTree
  storeyInfoByNodeId: Record<string, StoreyInfo>
  roomNumbers: Map<number, string>
}): RoomListEntry[] => {
  const { tree, storeyInfoByNodeId, roomNumbers } = args
  const { treeIndexByStoreyId, storeyLabelById, storeyElevationById } = buildStoreyPresentation(
    tree,
    storeyInfoByNodeId
  )

  return Object.values(tree.nodes)
    .filter((node) => isIfcType(node, 'IFCSPACE') && node.expressID !== null)
    .map((node) => {
      const storey = resolveStoreyForNode(tree, node.id, storeyLabelById, storeyElevationById)
      return {
        nodeId: node.id,
        label: 'Mistnost',
        ifcId: node.expressID!,
        roomNumber: roomNumbers.get(node.expressID!) ?? null,
        storeyId: storey.id,
        storeyLabel: storey.label,
        storeyElevation: storey.elevation
      }
    })
    .sort((left, right) => {
      const leftElevation = left.storeyElevation
      const rightElevation = right.storeyElevation
      const leftHasElevation = typeof leftElevation === 'number'
      const rightHasElevation = typeof rightElevation === 'number'
      if (leftHasElevation && rightHasElevation && leftElevation !== rightElevation) {
        return leftElevation - rightElevation
      }
      if (leftHasElevation !== rightHasElevation) {
        return leftHasElevation ? -1 : 1
      }

      const leftStoreyIndex =
        left.storeyId !== null && left.storeyId !== undefined
          ? treeIndexByStoreyId.get(left.storeyId) ?? Number.MAX_SAFE_INTEGER
          : Number.MAX_SAFE_INTEGER
      const rightStoreyIndex =
        right.storeyId !== null && right.storeyId !== undefined
          ? treeIndexByStoreyId.get(right.storeyId) ?? Number.MAX_SAFE_INTEGER
          : Number.MAX_SAFE_INTEGER
      if (leftStoreyIndex !== rightStoreyIndex) {
        return leftStoreyIndex - rightStoreyIndex
      }

      const leftKey = left.roomNumber?.trim() || left.label
      const rightKey = right.roomNumber?.trim() || right.label
      return leftKey.localeCompare(rightKey, undefined, {
        numeric: true,
        sensitivity: 'base'
      })
    })
}

// This builds a direct lookup from a viewer selection key to the corresponding tree node id.
export const buildTreeNodeSelectionMap = (nodes: ObjectTree['nodes']): Map<string, string> => {
  const byKey = new Map<string, string>()
  Object.values(nodes).forEach((node) => {
    if (node.expressID === null) return
    const key = `${node.modelID}:${node.expressID}`
    if (!byKey.has(key)) {
      byKey.set(key, node.id)
    }
  })
  return byKey
}

// This climbs the tree to find the nearest containing room for a selected node.
export const resolveContainingRoomNodeId = (
  nodes: ObjectTree['nodes'],
  nodeId: string | null | undefined
): string | null => {
  let currentId = nodeId
  while (currentId) {
    const node = nodes[currentId]
    if (!node) break
    if (isIfcType(node, 'IFCSPACE')) {
      return currentId
    }
    currentId = node.parentId
  }
  return null
}

// This marks only nodes below a room boundary as editable when room-only editing is enabled.
export const isTreeNodeEditableWithinRoom = (
  nodes: ObjectTree['nodes'],
  nodeId: string | null | undefined
): boolean => {
  const roomNodeId = resolveContainingRoomNodeId(nodes, nodeId)
  return Boolean(roomNodeId && roomNodeId !== nodeId)
}

// This collects every IFC express id below a tree node so group highlight can target whole branches.
export const collectIfcIdsInSubtree = (
  tree: ObjectTree,
  rootNodeId: string
): { modelID: number | null; ids: number[] } => {
  const root = tree.nodes[rootNodeId]
  if (!root) {
    return { modelID: null, ids: [] }
  }

  let modelID: number | null = root.nodeType === 'ifc' ? root.modelID : null
  const ids = new Set<number>()
  const stack = [rootNodeId]

  while (stack.length > 0) {
    const nodeId = stack.pop()
    if (!nodeId) continue
    const node = tree.nodes[nodeId]
    if (!node) continue

    if (node.nodeType === 'ifc' && node.expressID !== null) {
      if (modelID === null) {
        modelID = node.modelID
      }
      if (node.modelID === modelID) {
        ids.add(node.expressID)
      }
    }

    if (node.children.length > 0) {
      stack.push(...node.children)
    }
  }

  return { modelID, ids: Array.from(ids) }
}
