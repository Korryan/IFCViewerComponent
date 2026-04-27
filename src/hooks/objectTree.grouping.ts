import type { ObjectTree, ObjectTreeNode } from '../ifcViewerTypes'
import { IFC_SPATIAL_TYPES } from '../ifcRoomTree.constants'

// This normalizes one IFC type string so grouping checks stay predictable.
const normalizeIfcType = (type?: string): string => (type ?? '').toUpperCase()

// This checks whether one tree node matches the requested IFC type.
const isIfcType = (node: ObjectTreeNode, target: string): boolean =>
  node.nodeType === 'ifc' && normalizeIfcType(node.type) === target

// This prevents regrouping from introducing a parent-child cycle into the object tree.
const wouldCreateCycle = (
  tree: ObjectTree,
  nextNodes: ObjectTree['nodes'],
  ancestorId: string,
  nodeId: string
): boolean => {
  let cursor: string | null = ancestorId
  while (cursor) {
    if (cursor === nodeId) return true
    const cursorNode: ObjectTreeNode | undefined = nextNodes[cursor] ?? tree.nodes[cursor]
    cursor = cursorNode?.parentId ?? null
  }
  return false
}

// This detaches one node from its current parent while preserving the rest of the tree.
const detachChildFromParent = (
  tree: ObjectTree,
  nextNodes: ObjectTree['nodes'],
  childId: string,
  parentId: string | null
) => {
  if (!parentId) return
  const previousParent = nextNodes[parentId] ?? tree.nodes[parentId]
  if (!previousParent || !previousParent.children.includes(childId)) return
  nextNodes[previousParent.id] = {
    ...previousParent,
    children: previousParent.children.filter((currentChildId) => currentChildId !== childId)
  }
}

// This rebuilds the root list after regrouping changes have updated parent links.
const collectRootsFromNodes = (nodes: ObjectTree['nodes']): string[] => {
  const rootSet = new Set<string>()
  Object.values(nodes).forEach((node: ObjectTreeNode) => {
    if (node.parentId === null) {
      rootSet.add(node.id)
    }
  })
  return Array.from(rootSet)
}

// This heuristically groups non-spatial elements under rooms when matching room numbers are available.
export const groupIfcTreeByRoomNumber = (
  tree: ObjectTree,
  roomNumbers: Map<number, string>
): ObjectTree => {
  if (roomNumbers.size === 0) return tree
  let changed = false
  const nextNodes: ObjectTree['nodes'] = { ...tree.nodes }
  const storeyNodes = Object.values(tree.nodes).filter((node) => isIfcType(node, 'IFCBUILDINGSTOREY'))

  storeyNodes.forEach((storey) => {
    if (storey.children.length === 0) return
    const roomToSpaceId = new Map<string, string>()
    const stack = [...storey.children]
    const visited = new Set<string>()
    const candidateNodeIds: string[] = []

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

      const nodeType = normalizeIfcType(node.type)
      if (nodeType === 'IFCSPACE') {
        const roomNumber = roomNumbers.get(node.expressID)
        if (roomNumber && !roomToSpaceId.has(roomNumber)) {
          roomToSpaceId.set(roomNumber, nodeId)
        }
        continue
      }
      if (IFC_SPATIAL_TYPES.has(nodeType) || nodeType.startsWith('IFCREL')) continue
      candidateNodeIds.push(nodeId)
    }

    if (roomToSpaceId.size === 0) return

    candidateNodeIds.forEach((candidateNodeId) => {
      const child = nextNodes[candidateNodeId] ?? tree.nodes[candidateNodeId]
      if (!child || child.expressID === null) return
      const roomNumber = roomNumbers.get(child.expressID)
      if (!roomNumber) return
      const spaceId = roomToSpaceId.get(roomNumber)
      if (!spaceId) return

      let ancestorId = child.parentId
      while (ancestorId) {
        if (ancestorId === storey.id) break
        const ancestor = nextNodes[ancestorId] ?? tree.nodes[ancestorId]
        if (!ancestor || ancestor.nodeType !== 'ifc' || ancestor.expressID === null) break
        if (ancestor.id === spaceId) {
          return
        }
        const ancestorRoomNumber = roomNumbers.get(ancestor.expressID)
        const ancestorType = normalizeIfcType(ancestor.type)
        if (ancestorRoomNumber === roomNumber && !IFC_SPATIAL_TYPES.has(ancestorType)) {
          return
        }
        ancestorId = ancestor.parentId
      }

      if (child.parentId === spaceId) return
      if (wouldCreateCycle(tree, nextNodes, spaceId, candidateNodeId)) return

      detachChildFromParent(tree, nextNodes, candidateNodeId, child.parentId)

      const currentSpace = nextNodes[spaceId] ?? tree.nodes[spaceId]
      if (!currentSpace) return

      nextNodes[candidateNodeId] = {
        ...child,
        parentId: spaceId
      }
      nextNodes[spaceId] = {
        ...currentSpace,
        children: currentSpace.children.includes(candidateNodeId)
          ? currentSpace.children
          : [...currentSpace.children, candidateNodeId]
      }
      changed = true
    })
  })

  return changed ? { nodes: nextNodes, roots: tree.roots } : tree
}

// This re-parents elements under their containing rooms using explicit IFC spatial containment relations.
export const groupIfcTreeBySpatialContainment = (
  tree: ObjectTree,
  containingSpaceByElement: Map<number, number>
): ObjectTree => {
  if (containingSpaceByElement.size === 0) return tree

  const nextNodes: ObjectTree['nodes'] = { ...tree.nodes }
  const nodeIdByExpressId = new Map<number, string>()
  Object.values(tree.nodes).forEach((node) => {
    if (node.nodeType !== 'ifc' || node.expressID === null) return
    if (!nodeIdByExpressId.has(node.expressID)) {
      nodeIdByExpressId.set(node.expressID, node.id)
    }
  })

  let changed = false
  containingSpaceByElement.forEach((spaceExpressId, elementExpressId) => {
    const elementNodeId = nodeIdByExpressId.get(elementExpressId)
    const spaceNodeId = nodeIdByExpressId.get(spaceExpressId)
    if (!elementNodeId || !spaceNodeId || elementNodeId === spaceNodeId) return

    const elementNode = nextNodes[elementNodeId] ?? tree.nodes[elementNodeId]
    const spaceNode = nextNodes[spaceNodeId] ?? tree.nodes[spaceNodeId]
    if (!elementNode || !spaceNode) return
    if (elementNode.nodeType !== 'ifc' || spaceNode.nodeType !== 'ifc') return
    if (normalizeIfcType(spaceNode.type) !== 'IFCSPACE') return

    const elementType = normalizeIfcType(elementNode.type)
    if (IFC_SPATIAL_TYPES.has(elementType) || elementType.startsWith('IFCREL')) return
    if (elementNode.parentId === spaceNodeId) return
    if (wouldCreateCycle(tree, nextNodes, spaceNodeId, elementNodeId)) return

    detachChildFromParent(tree, nextNodes, elementNodeId, elementNode.parentId)

    const targetSpace = nextNodes[spaceNodeId] ?? tree.nodes[spaceNodeId]
    const nextChildren = targetSpace.children.includes(elementNodeId)
      ? targetSpace.children
      : [...targetSpace.children, elementNodeId]
    nextNodes[spaceNodeId] = {
      ...targetSpace,
      children: nextChildren
    }
    nextNodes[elementNodeId] = {
      ...elementNode,
      parentId: spaceNodeId
    }
    changed = true
  })

  if (!changed) return tree

  return {
    nodes: nextNodes,
    roots: collectRootsFromNodes(nextNodes)
  }
}
