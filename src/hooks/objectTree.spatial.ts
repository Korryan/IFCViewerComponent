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

type BuildIndex = {
  idByIfcId: Map<number, string>
  edgeKeys: Set<string>
}

// This normalizes one spatial id value regardless of whether the source stores it directly or wrapped in a value object.
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

// This resolves the best available spatial id field from mixed IFC spatial structure payloads.
const getSpatialNodeId = (node: SpatialNode): number | null => {
  const directExpress = parseSpatialId(node.expressID)
  if (directExpress !== null) return directExpress
  const directExpressAlt = parseSpatialId(node.expressId)
  if (directExpressAlt !== null) return directExpressAlt
  return parseSpatialId(node.localId)
}

// This normalizes the spatial node type so tree building works across different source payload shapes.
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

// This builds the localized label shown for one IFC type in the object tree.
const buildLabel = (type: string): string => {
  if (type !== 'UNKNOWN') return localizeIfcType(type)
  return 'IFC prvek'
}

// This extracts a human-readable name from the mixed naming fields found in spatial payloads.
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

// This normalizes one IFC type string so upgrade checks stay consistent.
const normalizeIfcType = (type?: string): string => (type ?? '').toUpperCase()

// This creates the canonical tree node id for one IFC element in one model.
const makeIfcNodeId = (modelID: number, ifcId: number): string => `ifc-${modelID}-${ifcId}`

// This returns spatial children as a predictable array even when the source omits the field.
const getSpatialChildren = (node: SpatialNode): SpatialNode[] =>
  Array.isArray(node.children) ? node.children : []

// This collapses wrapper-only spatial nodes so the built tree keeps the real IFC element and its children together.
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

// This inserts one IFC node into the accumulator or upgrades the existing node if the new payload is more informative.
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
      const shouldUpgradeType =
        normalizeIfcType(existing.type) === 'UNKNOWN' && normalizeIfcType(type) !== 'UNKNOWN'
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

// This connects one child to one parent while ignoring duplicate or conflicting relation paths.
const connectParentChild = (parentId: string | null, childId: string, acc: ObjectTree, index: BuildIndex) => {
  if (!parentId) return
  const parent = acc.nodes[parentId]
  const child = acc.nodes[childId]
  if (!parent || !child) return

  if (child.parentId !== null && child.parentId !== parentId) {
    return
  }

  child.parentId = parentId
  const edgeKey = `${parentId}->${childId}`
  if (index.edgeKeys.has(edgeKey)) return
  index.edgeKeys.add(edgeKey)
  parent.children.push(childId)
}

// This traverses one spatial subtree and emits canonical IFC nodes into the accumulator.
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

// This rebuilds the root list from the accumulated nodes once traversal is finished.
const collectRootIds = (tree: ObjectTree, preferredRootIds: string[]): string[] => {
  const dedupRoots = new Set<string>()
  preferredRootIds.forEach((id) => {
    const node = tree.nodes[id]
    if (node && node.parentId === null) {
      dedupRoots.add(id)
    }
  })

  if (dedupRoots.size === 0) {
    Object.values(tree.nodes).forEach((node: ObjectTreeNode) => {
      if (node.parentId === null) {
        dedupRoots.add(node.id)
      }
    })
  }

  return Array.from(dedupRoots)
}

// This builds a canonical IFC tree from a spatial structure while collapsing wrapper-only nodes.
export const buildIfcTree = (spatialRoot: SpatialNode | null | undefined, modelID: number): ObjectTree => {
  if (!spatialRoot) return { nodes: {}, roots: [] }
  const acc: ObjectTree = { nodes: {}, roots: [] }
  const visited = new WeakSet<object>()
  const index: BuildIndex = {
    idByIfcId: new Map<number, string>(),
    edgeKeys: new Set<string>()
  }
  const rootIds = traverseSpatial(spatialRoot, modelID, null, acc, visited, index)
  acc.roots.push(...collectRootIds(acc, rootIds))
  return acc
}
