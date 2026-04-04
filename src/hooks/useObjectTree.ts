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
  ifcClass?: string | null
  _category?: string | null
  Name?: { value?: string }
  name?: string
}

const emptyTree: ObjectTree = { nodes: {}, roots: [] }
const CUSTOM_NODE_PREFIX = 'custom-node-'

const parseSpatialId = (raw: unknown): number | null => {
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
    return parseSpatialId((raw as { value?: unknown }).value)
  }
  return null
}

const getSpatialNodeId = (node: SpatialNode): number | null => {
  const directExpress = parseSpatialId(node.expressID)
  if (directExpress !== null) return directExpress
  const directExpressAlt = parseSpatialId(node.expressId)
  if (directExpressAlt !== null) return directExpressAlt
  return parseSpatialId(node.localId)
}

const normalizeSpatialType = (node: SpatialNode): string => {
  const raw = node.type ?? node.ifcClass ?? node.category ?? node._category ?? ''
  const value =
    typeof raw === 'string'
      ? raw
      : raw && typeof raw === 'object' && 'value' in (raw as Record<string, unknown>)
        ? String((raw as { value?: unknown }).value ?? '')
        : String(raw)
  const normalized = value.trim().toUpperCase()
  return normalized || 'UNKNOWN'
}

const buildLabel = (type: string): string => {
  if (type !== 'UNKNOWN') return localizeIfcType(type)
  return 'IFC prvek'
}

const extractSpatialName = (node: SpatialNode): string | null => {
  const raw =
    typeof node.name === 'string'
      ? node.name
      : typeof node.Name?.value === 'string'
        ? node.Name.value
        : null
  const trimmed = raw?.trim()
  return trimmed ? trimmed : null
}

const normalizeIfcType = (type?: string): string => (type ?? '').toUpperCase()
const isIfcType = (node: ObjectTreeNode, target: string): boolean =>
  node.nodeType === 'ifc' && normalizeIfcType(node.type) === target

const makeIfcNodeId = (modelID: number, ifcId: number): string => `ifc-${modelID}-${ifcId}`

const getSpatialChildren = (node: SpatialNode): SpatialNode[] =>
  Array.isArray(node.children) ? node.children : []

const resolveEffectiveSpatialNode = (node: SpatialNode): {
  ifcId: number | null
  type: string
  name: string | null
  children: SpatialNode[]
} => {
  const ifcId = getSpatialNodeId(node)
  const type = normalizeSpatialType(node)
  const name = extractSpatialName(node)
  const children = getSpatialChildren(node)

  if (ifcId === null) {
    return { ifcId: null, type, name, children }
  }

  if (type !== 'UNKNOWN') {
    return { ifcId, type, name, children }
  }

  // Typical converted structure: wrapper keeps localId, child keeps IFC category/type.
  if (children.length === 1) {
    const onlyChild = children[0]
    const childType = normalizeSpatialType(onlyChild)
    const childIfcId = getSpatialNodeId(onlyChild)
    if (childType !== 'UNKNOWN' && childIfcId !== null) {
      return {
        ifcId: childIfcId,
        type: childType,
        name: extractSpatialName(onlyChild) ?? name,
        children: getSpatialChildren(onlyChild)
      }
    }
  }

  return { ifcId, type, name, children }
}

type BuildIndex = {
  idByIfcId: Map<number, string>
  edgeKeys: Set<string>
}

const ensureIfcNode = (
  modelID: number,
  ifcId: number,
  type: string,
  name: string | null,
  parentId: string | null,
  acc: ObjectTree,
  index: BuildIndex
): string => {
  const existingId = index.idByIfcId.get(ifcId)
  if (existingId) {
    const existing = acc.nodes[existingId]
    if (existing) {
      const shouldUpgradeType = normalizeIfcType(existing.type) === 'UNKNOWN' && normalizeIfcType(type) !== 'UNKNOWN'
      if (shouldUpgradeType) {
        existing.type = type
        existing.label = buildLabel(type)
      }
      if (!existing.name && name) {
        existing.name = name
      }
      if (existing.parentId === null && parentId) {
        existing.parentId = parentId
      }
    }
    return existingId
  }

  const id = makeIfcNodeId(modelID, ifcId)
  acc.nodes[id] = {
    id,
    modelID,
    expressID: ifcId,
    label: buildLabel(type),
    name,
    type,
    nodeType: 'ifc',
    parentId,
    children: []
  }
  index.idByIfcId.set(ifcId, id)
  return id
}

const connectParentChild = (parentId: string | null, childId: string, acc: ObjectTree, index: BuildIndex) => {
  if (!parentId) return
  const parent = acc.nodes[parentId]
  const child = acc.nodes[childId]
  if (!parent || !child) return

  // Keep one canonical parent per IFC node; duplicated relation paths are ignored.
  if (child.parentId !== null && child.parentId !== parentId) {
    return
  }

  child.parentId = parentId
  const edgeKey = `${parentId}->${childId}`
  if (index.edgeKeys.has(edgeKey)) return
  index.edgeKeys.add(edgeKey)
  parent.children.push(childId)
}

const traverseSpatial = (
  node: SpatialNode,
  modelID: number,
  parentId: string | null,
  acc: ObjectTree,
  visited: WeakSet<object>,
  index: BuildIndex
): string[] => {
  if (!node || typeof node !== 'object') return []
  if (visited.has(node as object)) return []
  visited.add(node as object)

  const { ifcId, type, name, children } = resolveEffectiveSpatialNode(node)
  if (ifcId === null) {
    const promoted: string[] = []
    children.forEach((child) => {
      promoted.push(...traverseSpatial(child, modelID, parentId, acc, visited, index))
    })
    return promoted
  }

  const id = ensureIfcNode(modelID, ifcId, type, name, parentId, acc, index)
  connectParentChild(parentId, id, acc, index)

  if (children.length > 0) {
    children.forEach((child) => {
      traverseSpatial(child, modelID, id, acc, visited, index)
    })
  }

  return [id]
}

export const buildIfcTree = (spatialRoot: SpatialNode | null | undefined, modelID: number): ObjectTree => {
  if (!spatialRoot) return emptyTree
  const acc: ObjectTree = { nodes: {}, roots: [] }
  const visited = new WeakSet<object>()
  const index: BuildIndex = {
    idByIfcId: new Map<number, string>(),
    edgeKeys: new Set<string>()
  }
  const rootIds = traverseSpatial(spatialRoot, modelID, null, acc, visited, index)
  const dedupRoots = new Set<string>()
  rootIds.forEach((id) => {
    const node = acc.nodes[id]
    if (node && node.parentId === null) {
      dedupRoots.add(id)
    }
  })
  if (dedupRoots.size === 0) {
    Object.values(acc.nodes).forEach((node) => {
      if (node.parentId === null) {
        dedupRoots.add(node.id)
      }
    })
  }
  acc.roots.push(...Array.from(dedupRoots))
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

const IFC_SPATIAL_TYPES = new Set([
  'IFCPROJECT',
  'IFCSITE',
  'IFCBUILDING',
  'IFCBUILDINGSTOREY',
  'IFCSPACE'
])

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

    // Prevent accidental cycle when broken source data references descendants.
    let cursor: string | null = spaceNodeId
    while (cursor) {
      if (cursor === elementNodeId) return
      const cursorNode: ObjectTreeNode | undefined = nextNodes[cursor] ?? tree.nodes[cursor]
      cursor = cursorNode?.parentId ?? null
    }

    if (elementNode.parentId) {
      const previousParent = nextNodes[elementNode.parentId] ?? tree.nodes[elementNode.parentId]
      if (previousParent && previousParent.children.includes(elementNodeId)) {
        nextNodes[previousParent.id] = {
          ...previousParent,
          children: previousParent.children.filter((childId) => childId !== elementNodeId)
        }
      }
    }

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

  const rootSet = new Set<string>()
  Object.values(nextNodes).forEach((node) => {
    if (node.parentId === null) {
      rootSet.add(node.id)
    }
  })

  return {
    nodes: nextNodes,
    roots: Array.from(rootSet)
  }
}

// Hook that owns the tree state; UI can subscribe later
export const useObjectTree = () => {
  const [tree, setTree] = useState<ObjectTree>(emptyTree)
  const customIdCounterRef = useRef(1)

  const setIfcTree = useCallback((next: ObjectTree, modelID: number) => {
    void modelID
    setTree(next)
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
        const next = prev
        const resolvedParentId =
          payload.parentId && next.nodes[payload.parentId] ? payload.parentId : null

        const parent = resolvedParentId ? next.nodes[resolvedParentId] : null

        if (next.nodes[nextId]) {
          const existing = next.nodes[nextId]
          const nextParentId = resolvedParentId ?? existing.parentId
          const parentUnchanged = existing.parentId === nextParentId
          const labelUnchanged =
            existing.label === payload.label &&
            existing.name === payload.label &&
            existing.type === (payload.type ?? existing.type)

          if (parentUnchanged && labelUnchanged) {
            return next
          }

          const nextNodes: ObjectTree['nodes'] = {
            ...next.nodes,
            [nextId]: {
              ...existing,
              label: payload.label,
              name: payload.label,
              type: payload.type ?? existing.type,
              parentId: nextParentId
            }
          }

          let nextRoots = next.roots

          if (existing.parentId && nextNodes[existing.parentId]) {
            nextNodes[existing.parentId] = {
              ...nextNodes[existing.parentId],
              children: nextNodes[existing.parentId].children.filter((childId) => childId !== nextId)
            }
          } else if (existing.parentId === null) {
            nextRoots = nextRoots.filter((rootId) => rootId !== nextId)
          }

          if (nextParentId && nextNodes[nextParentId]) {
            const nextParent = nextNodes[nextParentId]
            if (!nextParent.children.includes(nextId)) {
              nextNodes[nextParentId] = {
                ...nextParent,
                children: [...nextParent.children, nextId]
              }
            }
          } else if (!nextRoots.includes(nextId)) {
            nextRoots = [...nextRoots, nextId]
          }

          return {
            nodes: nextNodes,
            roots: nextRoots
          }
        }

        const node: ObjectTreeNode = {
          id: nextId,
          modelID: payload.modelID,
          expressID: payload.expressID ?? null,
          label: payload.label,
          name: payload.label,
          type: payload.type ?? 'CUSTOM',
          nodeType: 'custom',
          parentId: resolvedParentId,
          children: []
        }

        const nextRoots = resolvedParentId ? next.roots : [...next.roots, nextId]
        return {
          nodes: {
            ...next.nodes,
            [nextId]: node,
            ...(resolvedParentId && parent
              ? {
                  [resolvedParentId]: {
                    ...parent,
                    children: [...parent.children, nextId]
                  }
                }
              : {})
          },
          roots: nextRoots
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
