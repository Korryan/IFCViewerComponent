import type { ObjectTree } from './ifcViewerTypes'
import type { IfcViewerAPI } from './viewer/IfcViewerAPICompat'
import {
  MAX_ROOM_NUMBER_LOOKUPS,
  ROOM_NUMBER_BATCH_SIZE
} from './ifcViewer.constants'
import {
  extractRoomNumber,
  resolveContainedSpaceId,
  resolveContainedSpaceIdFromRelation
} from './ifcViewer.utils'

const IFC_SPATIAL_TYPES = new Set([
  'IFCPROJECT',
  'IFCSITE',
  'IFCBUILDING',
  'IFCBUILDINGSTOREY',
  'IFCSPACE'
])

const collectStoreyChildExpressIds = (tree: ObjectTree): number[] => {
  const ids = new Set<number>()
  Object.values(tree.nodes).forEach((node) => {
    if (node.nodeType !== 'ifc') return
    if (node.type.toUpperCase() !== 'IFCBUILDINGSTOREY') return
    node.children.forEach((childId) => {
      const child = tree.nodes[childId]
      if (!child || child.nodeType !== 'ifc' || child.expressID === null) return
      ids.add(child.expressID)
    })
  })
  return Array.from(ids)
}

export const buildRoomNumberMap = async (
  viewer: IfcViewerAPI,
  tree: ObjectTree,
  modelID: number
): Promise<Map<number, string>> => {
  const expressIds = collectStoreyChildExpressIds(tree)
  if (expressIds.length === 0) return new Map()

  const lookupIds =
    expressIds.length > MAX_ROOM_NUMBER_LOOKUPS ? expressIds.slice(0, MAX_ROOM_NUMBER_LOOKUPS) : expressIds

  if (lookupIds.length < expressIds.length) {
    console.warn(
      `Room-number lookup limited to ${MAX_ROOM_NUMBER_LOOKUPS} of ${expressIds.length} elements to prevent OOM.`
    )
  }

  const results: Array<readonly [number, string] | null> = []
  for (let i = 0; i < lookupIds.length; i += ROOM_NUMBER_BATCH_SIZE) {
    const batch = lookupIds.slice(i, i + ROOM_NUMBER_BATCH_SIZE)
    const batchResults = await Promise.all(
      batch.map(async (expressID) => {
        try {
          const properties = await viewer.IFC.getProperties(modelID, expressID, false, true)
          const roomNumber = extractRoomNumber(properties)
          return roomNumber ? ([expressID, roomNumber] as const) : null
        } catch (err) {
          console.warn('Failed to read room number for element', expressID, err)
          return null
        }
      })
    )
    results.push(...batchResults)
  }

  const map = new Map<number, string>()
  results.forEach((entry) => {
    if (!entry) return
    map.set(entry[0], entry[1])
  })
  return map
}

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

export { IFC_SPATIAL_TYPES }

export type StoreyInfo = {
  elevation: number | null
  name: string | null
  longName: string | null
}

const normalizeIfcScalar = (value: unknown): unknown => {
  if (value && typeof value === 'object' && 'value' in (value as Record<string, unknown>)) {
    return normalizeIfcScalar((value as { value?: unknown }).value)
  }
  return value
}

const readIfcString = (value: unknown): string | null => {
  const normalized = normalizeIfcScalar(value)
  if (typeof normalized !== 'string') return null
  const trimmed = normalized.trim()
  return trimmed.length > 0 ? trimmed : null
}

const readIfcNumber = (value: unknown): number | null => {
  const normalized = normalizeIfcScalar(value)
  if (typeof normalized === 'number' && Number.isFinite(normalized)) {
    return normalized
  }
  if (typeof normalized === 'string' && normalized.trim().length > 0) {
    const parsed = Number(normalized)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

export const buildStoreyInfoMap = async (
  viewer: IfcViewerAPI,
  tree: ObjectTree,
  modelID: number
): Promise<Map<string, StoreyInfo>> => {
  const storeys = Object.values(tree.nodes).filter(
    (node) => node.nodeType === 'ifc' && node.expressID !== null && node.type.toUpperCase() === 'IFCBUILDINGSTOREY'
  )
  if (storeys.length === 0) {
    return new Map()
  }

  const entries = await Promise.all(
    storeys.map(async (storey) => {
      try {
        const properties = await viewer.IFC.getProperties(modelID, storey.expressID!, false, false)
        return [
          storey.id,
          {
            elevation:
              readIfcNumber(properties?.Elevation) ??
              readIfcNumber(properties?.elevation) ??
              null,
            name: readIfcString(properties?.Name) ?? readIfcString(properties?.name) ?? storey.name ?? null,
            longName:
              readIfcString(properties?.LongName) ??
              readIfcString(properties?.longName) ??
              null
          } satisfies StoreyInfo
        ] as const
      } catch (err) {
        console.warn('Failed to read storey info for element', storey.expressID, err)
        return [
          storey.id,
          {
            elevation: null,
            name: storey.name ?? null,
            longName: null
          } satisfies StoreyInfo
        ] as const
      }
    })
  )

  return new Map(entries)
}
