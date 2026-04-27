import type { FurnitureItem, ObjectTree } from './ifcViewerTypes'
import type { IfcViewerAPI } from './viewer/IfcViewerAPICompat'

// This reads one raw IFC attribute as a trimmed string regardless of whether fragments wraps it in a value object.
const readIfcString = (value: unknown): string | null => {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed || null
  }
  if (!value || typeof value !== 'object') {
    return null
  }

  const wrapped = value as { value?: unknown }
  if (typeof wrapped.value === 'string') {
    const trimmed = wrapped.value.trim()
    return trimmed || null
  }
  return null
}

// This normalizes one IFC type label so reconciliation can target furnishing elements predictably.
const normalizeIfcType = (type?: string): string => (type ?? '').trim().toUpperCase()

// This collects furniture item ids that already exist in the loaded IFC model as real IfcFurnishingElement objects.
export const collectMaterializedFurnitureItemIds = async (args: {
  viewer: IfcViewerAPI
  tree: ObjectTree
  modelID: number
  furnitureEntries: FurnitureItem[]
}): Promise<Set<string>> => {
  const pendingIds = new Set(
    args.furnitureEntries
      .map((item) => (typeof item.id === 'string' ? item.id.trim() : ''))
      .filter((itemId) => itemId.length > 0)
  )
  if (pendingIds.size === 0) {
    return new Set()
  }

  const pendingNames = new Set(
    args.furnitureEntries
      .map((item) => (typeof item.name === 'string' ? item.name.trim() : item.id.trim()))
      .filter((name) => name.length > 0)
  )

  const candidates = Object.values(args.tree.nodes).filter((node) => {
    if (node.nodeType !== 'ifc' || node.modelID !== args.modelID || node.expressID === null) {
      return false
    }
    const normalizedType = normalizeIfcType(node.type)
    if (normalizedType === 'IFCFURNISHINGELEMENT') {
      return true
    }
    const nodeName = (node.name ?? '').trim()
    return nodeName.length > 0 && pendingNames.has(nodeName)
  })

  const materializedIds = new Set<string>()
  for (const node of candidates) {
    if (pendingIds.size === 0) {
      break
    }

    try {
      const properties = await args.viewer.IFC.getProperties(args.modelID, node.expressID!, false, false)
      const itemId = readIfcString(properties?.Tag)
      if (!itemId || !pendingIds.has(itemId)) {
        continue
      }
      materializedIds.add(itemId)
      pendingIds.delete(itemId)
    } catch (error) {
      console.warn(`Failed to reconcile furniture item for IFC element #${node.expressID}`, error)
    }
  }

  return materializedIds
}
