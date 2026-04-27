import type { ObjectTree, Point3D } from '../ifcViewerTypes'
import type {
  EnsureIfcPlacementPosition,
  GetElementWorldPosition,
  GetIfcElementPlacementPosition,
  SelectById
} from './insertActions.types'

// This resolves the nearest room node above one tree node so inserts can inherit room context.
export const resolveSpaceNodeForTreeNode = (
  tree: ObjectTree,
  nodeId: string | null | undefined
): ObjectTree['nodes'][string] | null => {
  if (!nodeId) return null
  let currentId: string | null | undefined = nodeId
  while (currentId) {
    const node: ObjectTree['nodes'][string] | undefined = tree.nodes[currentId]
    if (!node) break
    if (node.nodeType === 'ifc' && node.expressID !== null && node.type.toUpperCase() === 'IFCSPACE') {
      return node
    }
    currentId = node.parentId
  }
  return null
}

// This resolves the first room-number match found while walking from one node to the root.
export const resolveRoomNumberForTreeNode = (
  tree: ObjectTree,
  roomNumbers: Map<number, string>,
  nodeId: string | null | undefined
): string | null => {
  if (!nodeId) return null
  let currentId: string | null | undefined = nodeId
  while (currentId) {
    const node: ObjectTree['nodes'][string] | undefined = tree.nodes[currentId]
    if (!node) break
    if (node.nodeType === 'ifc' && node.expressID !== null) {
      const roomNumber = roomNumbers.get(node.expressID)
      if (roomNumber) return roomNumber
    }
    currentId = node.parentId
  }
  return null
}

// This finds the room node id for a given room number inside the current tree snapshot.
export const findSpaceNodeIdByRoomNumberInTree = (
  tree: ObjectTree,
  roomNumbers: Map<number, string>,
  roomNumber: string | null | undefined
): string | null => {
  if (!roomNumber) return null
  for (const node of Object.values(tree.nodes)) {
    if (node.nodeType !== 'ifc') continue
    if (node.expressID === null) continue
    if (node.type.toUpperCase() !== 'IFCSPACE') continue
    const spaceRoomNumber = roomNumbers.get(node.expressID)
    if (spaceRoomNumber === roomNumber) {
      return node.id
    }
  }
  return null
}

// This finds the room node id for a given IFC express id inside the current tree snapshot.
export const findSpaceNodeIdByIfcIdInTree = (
  tree: ObjectTree,
  spaceIfcId: number | null | undefined
): string | null => {
  if (!Number.isFinite(spaceIfcId ?? NaN)) return null
  const targetIfcId = Math.trunc(spaceIfcId as number)
  for (const node of Object.values(tree.nodes)) {
    if (node.nodeType !== 'ifc') continue
    if (node.expressID === null) continue
    if (node.type.toUpperCase() !== 'IFCSPACE') continue
    if (node.expressID === targetIfcId) {
      return node.id
    }
  }
  return null
}

// This resolves the containing room express id above one tree node so inserted objects can inherit room metadata.
export const resolveSpaceIfcIdForTreeNode = (
  tree: ObjectTree,
  nodeId: string | null | undefined
): number | null => {
  const spaceNode = resolveSpaceNodeForTreeNode(tree, nodeId)
  return spaceNode?.expressID ?? null
}

// This chooses the parent room node when available and otherwise falls back to the requested node itself.
export const resolveInsertParentId = (
  tree: ObjectTree,
  nodeId: string | null | undefined
): string | null => {
  const spaceNode = resolveSpaceNodeForTreeNode(tree, nodeId)
  if (spaceNode) {
    return spaceNode.id
  }
  if (nodeId && tree.nodes[nodeId]) {
    return nodeId
  }
  return null
}

// This resolves a stable fallback target position from the containing room when direct selection does not provide one.
const resolveSpaceFallbackTarget = async (args: {
  spaceNode: ObjectTree['nodes'][string] | null
  getElementWorldPosition: GetElementWorldPosition
  getIfcElementPlacementPosition: GetIfcElementPlacementPosition
  ensureIfcPlacementPosition: EnsureIfcPlacementPosition
}): Promise<Point3D> => {
  const { spaceNode, getElementWorldPosition, getIfcElementPlacementPosition, ensureIfcPlacementPosition } = args
  if (!spaceNode || spaceNode.expressID === null) {
    return { x: 0, y: 0, z: 0 }
  }
  return (
    getElementWorldPosition(spaceNode.modelID, spaceNode.expressID) ??
    getIfcElementPlacementPosition(spaceNode.modelID, spaceNode.expressID) ??
    (await ensureIfcPlacementPosition(spaceNode.modelID, spaceNode.expressID)) ??
    { x: 0, y: 0, z: 0 }
  )
}

// This resolves the world target used to insert a prefab or upload relative to one tree node.
export const resolveInsertTargetForNode = async (args: {
  tree: ObjectTree
  nodeId: string
  options?: { autoFocus?: boolean }
  selectById: SelectById
  getElementWorldPosition: GetElementWorldPosition
  getIfcElementPlacementPosition: GetIfcElementPlacementPosition
  ensureIfcPlacementPosition: EnsureIfcPlacementPosition
}): Promise<Point3D> => {
  const {
    tree,
    nodeId,
    options,
    selectById,
    getElementWorldPosition,
    getIfcElementPlacementPosition,
    ensureIfcPlacementPosition
  } = args
  const node = tree.nodes[nodeId]
  const spaceNode =
    node && node.nodeType === 'ifc' && node.expressID !== null && node.type.toUpperCase() === 'IFCSPACE'
      ? node
      : resolveSpaceNodeForTreeNode(tree, nodeId)

  if (!node || node.nodeType !== 'ifc' || node.expressID === null) {
    return resolveSpaceFallbackTarget({
      spaceNode,
      getElementWorldPosition,
      getIfcElementPlacementPosition,
      ensureIfcPlacementPosition
    })
  }

  const target = await selectById(node.modelID, node.expressID, {
    autoFocus: options?.autoFocus
  })
  if (target) {
    return target
  }

  return resolveSpaceFallbackTarget({
    spaceNode,
    getElementWorldPosition,
    getIfcElementPlacementPosition,
    ensureIfcPlacementPosition
  })
}
