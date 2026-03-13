import { useCallback, useRef, useState } from 'react'
import type { ObjectTree, ObjectTreeNode } from '../ifcViewerTypes'
import { localizeIfcType } from '../utils/ifcTypeLocalization'

type SpatialNode = {
  expressID?: number | string | { value?: number | string | null } | null
  expressId?: number | string | { value?: number | string | null } | null
  localId?: number | string | { value?: number | string | null } | null
  children?: SpatialNode[]
  type?: string
  category?: string | null
  Name?: { value?: string }
  name?: string
}

const emptyTree: ObjectTree = { nodes: {}, roots: [] }
const CUSTOM_ROOT_PREFIX = 'custom-root-'
const CUSTOM_NODE_PREFIX = 'custom-node-'
const CUSTOM_ROOT_LABEL = 'Vlastni objekty'

const parseSpatialExpressId = (raw: unknown): number | null => {
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return Math.trunc(raw)
  }
  if (typeof raw === 'string' && raw.trim().length > 0) {
    const parsed = Number(raw)
    if (Number.isFinite(parsed)) {
      return Math.trunc(parsed)
    }
  }
  if (raw && typeof raw === 'object' && 'value' in (raw as Record<string, unknown>)) {
    return parseSpatialExpressId((raw as { value?: unknown }).value)
  }
  return null
}

const getSpatialLocalId = (node: SpatialNode): number | null => {
  return parseSpatialExpressId(node.localId)
}

const normalizeSpatialType = (node: SpatialNode): string => {
  const raw = node.type ?? node.category ?? ''
  const normalized = String(raw).trim().toUpperCase()
  return normalized || 'UNKNOWN'
}

const buildLabel = (type: string): string => {
  if (type !== 'UNKNOWN') return localizeIfcType(type)
  return 'IFC prvek'
}

const normalizeIfcType = (type?: string): string => (type ?? '').toUpperCase()
const isIfcType = (node: ObjectTreeNode, target: string): boolean =>
  node.nodeType === 'ifc' && normalizeIfcType(node.type) === target

const makeIfcNodeId = (
  modelID: number,
  localId: number,
  acc: ObjectTree,
): string => {
  const baseId = `ifc-${modelID}-${localId}`
  if (!acc.nodes[baseId]) return baseId
  let suffix = 1
  while (acc.nodes[`${baseId}-${suffix}`]) {
    suffix += 1
  }
  return `${baseId}-${suffix}`
}

const traverseSpatial = (
  node: SpatialNode,
  modelID: number,
  parentId: string | null,
  acc: ObjectTree,
  visited: WeakSet<object>
): string[] => {
  if (!node || typeof node !== 'object') return []
  if (visited.has(node as object)) return []
  visited.add(node as object)

  const localId = getSpatialLocalId(node)
  const type = normalizeSpatialType(node)
  const children = Array.isArray(node.children) ? node.children : []
  const isUnknown = type === 'UNKNOWN'

  if (isUnknown || localId === null) {
    const promoted: string[] = []
    children.forEach((child) => {
      promoted.push(...traverseSpatial(child, modelID, parentId, acc, visited))
    })
    return promoted
  }

  const id = makeIfcNodeId(modelID, localId, acc)
  const label = buildLabel(type)

  const treeNode: ObjectTreeNode = {
    id,
    modelID,
    expressID: localId,
    label,
    type,
    nodeType: 'ifc',
    parentId,
    children: []
  }

  acc.nodes[id] = treeNode

  if (children.length > 0) {
    children.forEach((child) => {
      const childIds = traverseSpatial(child, modelID, id, acc, visited)
      treeNode.children.push(...childIds)
    })
  }

  return [id]
}

export const buildIfcTree = (spatialRoot: SpatialNode | null | undefined, modelID: number): ObjectTree => {
  if (!spatialRoot) return emptyTree
  const acc: ObjectTree = { nodes: {}, roots: [] }
  const visited = new WeakSet<object>()
  const rootIds = traverseSpatial(spatialRoot, modelID, null, acc, visited)
  acc.roots.push(...rootIds)
  return acc
}

export const groupIfcTreeByRoomNumber = (
  tree: ObjectTree,
  roomNumbers: Map<number, string>
): ObjectTree => {
  // Heuristic grouping: re-parent elements under an IfcSpace if both share the same
  // room-number property. This is not an IFC relationship; it is derived from Pset text.
  if (roomNumbers.size === 0) return tree
  let changed = false
  const nextNodes: ObjectTree['nodes'] = { ...tree.nodes }
  const storeyNodes = Object.values(tree.nodes).filter((node) => isIfcType(node, 'IFCBUILDINGSTOREY'))

  storeyNodes.forEach((storey) => {
    if (storey.children.length === 0) return
    // Find the first IfcSpace node for each room number on this storey.
    const roomToSpaceId = new Map<string, string>()

    storey.children.forEach((childId) => {
      const child = tree.nodes[childId]
      if (!child || child.expressID === null) return
      if (!isIfcType(child, 'IFCSPACE')) return
      const roomNumber = roomNumbers.get(child.expressID)
      if (!roomNumber || roomToSpaceId.has(roomNumber)) return
      roomToSpaceId.set(roomNumber, childId)
    })

    if (roomToSpaceId.size === 0) return

    // Move non-space children under the matching IfcSpace (same room number).
    const removedFromStorey = new Set<string>()
    storey.children.forEach((childId) => {
      const child = tree.nodes[childId]
      if (!child || child.expressID === null) return
      if (isIfcType(child, 'IFCSPACE')) return
      const roomNumber = roomNumbers.get(child.expressID)
      if (!roomNumber) return
      const spaceId = roomToSpaceId.get(roomNumber)
      if (!spaceId) return
      removedFromStorey.add(childId)
      changed = true
      nextNodes[childId] = { ...child, parentId: spaceId }
      const currentSpace = nextNodes[spaceId] ?? tree.nodes[spaceId]
      if (currentSpace && !currentSpace.children.includes(childId)) {
        nextNodes[spaceId] = {
          ...currentSpace,
          children: [...currentSpace.children, childId]
        }
      }
    })

    if (removedFromStorey.size > 0) {
      nextNodes[storey.id] = {
        ...storey,
        children: storey.children.filter((childId) => !removedFromStorey.has(childId))
      }
    }
  })

  return changed ? { nodes: nextNodes, roots: tree.roots } : tree
}

const buildCustomRoot = (modelID: number): ObjectTreeNode => ({
  id: `${CUSTOM_ROOT_PREFIX}${modelID}`,
  modelID,
  expressID: null,
  label: CUSTOM_ROOT_LABEL,
  type: 'CUSTOM',
  nodeType: 'custom',
  parentId: null,
  children: []
})

const mergeWithCustomRoot = (tree: ObjectTree, modelID: number): ObjectTree => {
  const rootId = `${CUSTOM_ROOT_PREFIX}${modelID}`
  const nextNodes = { ...tree.nodes }
  const nextRoots = tree.roots.slice()
  if (!nextNodes[rootId]) {
    nextNodes[rootId] = buildCustomRoot(modelID)
    nextRoots.push(rootId)
  }
  return { nodes: nextNodes, roots: nextRoots }
}

// Hook that owns the tree state; UI can subscribe later
export const useObjectTree = () => {
  const [tree, setTree] = useState<ObjectTree>(emptyTree)
  const customIdCounterRef = useRef(1)

  const setIfcTree = useCallback((next: ObjectTree, modelID: number) => {
    setTree(mergeWithCustomRoot(next, modelID))
  }, [])

  const resetTree = useCallback(() => setTree(emptyTree), [])

  const addCustomNode = useCallback(
    (payload: {
      modelID: number
      expressID?: number | null
      label: string
      type?: string
      parentId?: string | null
    }) => {
      const nextId =
        payload.expressID !== undefined && payload.expressID !== null
          ? `${CUSTOM_NODE_PREFIX}${payload.modelID}-${payload.expressID}`
          : `${CUSTOM_NODE_PREFIX}${payload.modelID}-${customIdCounterRef.current++}`

      setTree((prev) => {
        const next = mergeWithCustomRoot(prev, payload.modelID)
        const rootId = `${CUSTOM_ROOT_PREFIX}${payload.modelID}`
        const resolvedParentId =
          payload.parentId && next.nodes[payload.parentId] ? payload.parentId : rootId

        const parent = next.nodes[resolvedParentId]
        if (!parent) {
          return next
        }

        if (next.nodes[nextId]) {
          return next
        }

        const node: ObjectTreeNode = {
          id: nextId,
          modelID: payload.modelID,
          expressID: payload.expressID ?? null,
          label: payload.label,
          type: payload.type ?? 'CUSTOM',
          nodeType: 'custom',
          parentId: resolvedParentId,
          children: []
        }

        return {
          nodes: {
            ...next.nodes,
            [nextId]: node,
            [resolvedParentId]: {
              ...parent,
              children: [...parent.children, nextId]
            }
          },
          roots: next.roots
        }
      })

      return nextId
    },
    []
  )

  const removeNode = useCallback((nodeId: string) => {
    setTree((prev) => {
      if (!prev.nodes[nodeId]) return prev
      // Remove the node and all descendants to keep the tree consistent after deletion.
      const toRemove = new Set<string>()
      const stack = [nodeId]
      while (stack.length > 0) {
        const current = stack.pop()
        if (!current || toRemove.has(current)) continue
        toRemove.add(current)
        const node = prev.nodes[current]
        if (node?.children?.length) {
          stack.push(...node.children)
        }
      }

      const nextNodes: ObjectTree['nodes'] = {}
      Object.entries(prev.nodes).forEach(([id, node]) => {
        if (toRemove.has(id)) return
        const filteredChildren = node.children.filter((childId) => !toRemove.has(childId))
        nextNodes[id] =
          filteredChildren.length === node.children.length
            ? node
            : { ...node, children: filteredChildren }
      })

      const nextRoots = prev.roots.filter((rootId) => !toRemove.has(rootId))
      return { nodes: nextNodes, roots: nextRoots }
    })
  }, [])

  return { tree, setIfcTree, resetTree, addCustomNode, removeNode }
}
