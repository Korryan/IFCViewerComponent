import type { ObjectTree, ObjectTreeNode } from '../ifcViewerTypes'

const CUSTOM_NODE_PREFIX = 'custom-node-'

type CustomNodePayload = {
  modelID: number
  expressID?: number | null
  label: string
  type?: string
  parentId?: string | null
}

type CustomNodeMutationResult = {
  nodeId: string
  nextTree: ObjectTree
  nextCounter: number
}

// This creates the stable custom node id used for one custom object in the tree.
const buildCustomNodeId = (payload: CustomNodePayload, counter: number): string =>
  payload.expressID !== undefined && payload.expressID !== null
    ? `${CUSTOM_NODE_PREFIX}${payload.modelID}-${payload.expressID}`
    : `${CUSTOM_NODE_PREFIX}${payload.modelID}-${counter}`

// This updates an existing custom node while keeping root membership and parent links consistent.
const updateExistingCustomNode = (args: {
  tree: ObjectTree
  nodeId: string
  payload: CustomNodePayload
  resolvedParentId: string | null
}): ObjectTree => {
  const { tree, nodeId, payload, resolvedParentId } = args
  const existing = tree.nodes[nodeId]
  const nextParentId = resolvedParentId ?? existing.parentId
  const parentUnchanged = existing.parentId === nextParentId
  const labelUnchanged =
    existing.label === payload.label &&
    existing.name === payload.label &&
    existing.type === (payload.type ?? existing.type)

  if (parentUnchanged && labelUnchanged) {
    return tree
  }

  const nextNodes: ObjectTree['nodes'] = {
    ...tree.nodes,
    [nodeId]: {
      ...existing,
      label: payload.label,
      name: payload.label,
      type: payload.type ?? existing.type,
      parentId: nextParentId
    }
  }

  let nextRoots = tree.roots

  if (existing.parentId && nextNodes[existing.parentId]) {
    nextNodes[existing.parentId] = {
      ...nextNodes[existing.parentId],
      children: nextNodes[existing.parentId].children.filter((childId) => childId !== nodeId)
    }
  } else if (existing.parentId === null) {
    nextRoots = nextRoots.filter((rootId) => rootId !== nodeId)
  }

  if (nextParentId && nextNodes[nextParentId]) {
    const nextParent = nextNodes[nextParentId]
    if (!nextParent.children.includes(nodeId)) {
      nextNodes[nextParentId] = {
        ...nextParent,
        children: [...nextParent.children, nodeId]
      }
    }
  } else if (!nextRoots.includes(nodeId)) {
    nextRoots = [...nextRoots, nodeId]
  }

  return {
    nodes: nextNodes,
    roots: nextRoots
  }
}

// This appends a brand-new custom node and links it into the requested parent when available.
const insertNewCustomNode = (args: {
  tree: ObjectTree
  nodeId: string
  payload: CustomNodePayload
  resolvedParentId: string | null
}): ObjectTree => {
  const { tree, nodeId, payload, resolvedParentId } = args
  const parent = resolvedParentId ? tree.nodes[resolvedParentId] : null
  const node: ObjectTreeNode = {
    id: nodeId,
    modelID: payload.modelID,
    expressID: payload.expressID ?? null,
    label: payload.label,
    name: payload.label,
    type: payload.type ?? 'CUSTOM',
    nodeType: 'custom',
    parentId: resolvedParentId,
    children: []
  }

  const nextRoots = resolvedParentId ? tree.roots : [...tree.roots, nodeId]
  return {
    nodes: {
      ...tree.nodes,
      [nodeId]: node,
      ...(resolvedParentId && parent
        ? {
            [resolvedParentId]: {
              ...parent,
              children: [...parent.children, nodeId]
            }
          }
        : {})
    },
    roots: nextRoots
  }
}

// This inserts or updates one custom node and also returns the next counter value for generated ids.
export const upsertCustomTreeNode = (args: {
  tree: ObjectTree
  payload: CustomNodePayload
  counter: number
}): CustomNodeMutationResult => {
  const { tree, payload, counter } = args
  const nodeId = buildCustomNodeId(payload, counter)
  const resolvedParentId = payload.parentId && tree.nodes[payload.parentId] ? payload.parentId : null

  if (tree.nodes[nodeId]) {
    return {
      nodeId,
      nextTree: updateExistingCustomNode({
        tree,
        nodeId,
        payload,
        resolvedParentId
      }),
      nextCounter: counter
    }
  }

  return {
    nodeId,
    nextTree: insertNewCustomNode({
      tree,
      nodeId,
      payload,
      resolvedParentId
    }),
    nextCounter:
      payload.expressID !== undefined && payload.expressID !== null ? counter : counter + 1
  }
}

// This removes one node and all descendants so the remaining tree stays structurally valid.
export const removeTreeNodeSubtree = (tree: ObjectTree, nodeId: string): ObjectTree => {
  if (!tree.nodes[nodeId]) return tree

  const toRemove = new Set<string>()
  const stack = [nodeId]
  while (stack.length > 0) {
    const current = stack.pop()
    if (!current || toRemove.has(current)) continue
    toRemove.add(current)
    const node = tree.nodes[current]
    if (node?.children?.length) {
      stack.push(...node.children)
    }
  }

  const nextNodes: ObjectTree['nodes'] = {}
  Object.entries(tree.nodes).forEach(([id, node]) => {
    if (toRemove.has(id)) return
    const filteredChildren = node.children.filter((childId) => !toRemove.has(childId))
    nextNodes[id] =
      filteredChildren.length === node.children.length
        ? node
        : { ...node, children: filteredChildren }
  })

  return {
    nodes: nextNodes,
    roots: tree.roots.filter((rootId) => !toRemove.has(rootId))
  }
}
