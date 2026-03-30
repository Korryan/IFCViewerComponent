import {
  CUBE_ITEM_PREFIX,
  ROOM_NUMBER_KEYS,
  UPLOADED_ITEM_PREFIX
} from './ifcViewer.constants'
import type { HistoryEntry, MetadataEntry } from './ifcViewerTypes'

export type LoadSource =
  | { kind: 'none' }
  | { kind: 'file'; file: File }
  | { kind: 'url'; url: string }

export const buildUploadedFurnitureId = (fileName: string) => {
  const slug =
    fileName
      .toLowerCase()
      .replace(/\.ifc$/i, '')
      .replace(/[^a-z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'asset'
  return `${UPLOADED_ITEM_PREFIX}${slug}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

export const buildUploadedFurnitureName = (fileName: string) =>
  fileName.replace(/\.ifc$/i, '') || fileName

export const isSameLoadSource = (left: LoadSource, right: LoadSource): boolean => {
  if (left.kind !== right.kind) return false
  if (left.kind === 'none') return true
  if (left.kind === 'file' && right.kind === 'file') return left.file === right.file
  if (left.kind === 'url' && right.kind === 'url') return left.url === right.url
  return false
}

export const withTimeout = async <T,>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string
): Promise<T> => {
  let timer: number | undefined
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = window.setTimeout(() => {
      reject(new Error(`${label} timed out after ${Math.round(timeoutMs / 1000)}s`))
    }, timeoutMs)
  })

  try {
    return (await Promise.race([promise, timeoutPromise])) as T
  } finally {
    if (timer !== undefined) {
      window.clearTimeout(timer)
    }
  }
}

export const normalizeIfcValue = (rawValue: any): string => {
  if (rawValue === null || rawValue === undefined) {
    return ''
  }
  if (typeof rawValue === 'object') {
    if ('value' in rawValue) {
      return rawValue.value === null || rawValue.value === undefined ? '' : String(rawValue.value)
    }
    if (Array.isArray(rawValue)) {
      return rawValue.map((entry) => normalizeIfcValue(entry)).join(', ')
    }
    return ''
  }
  return String(rawValue)
}

const normalizePropertyKey = (value: string): string =>
  value.toLowerCase().replace(/[\s_-]+/g, '')

export const normalizeIfcTypeValue = (value: unknown): string | null => {
  if (typeof value === 'string') {
    const normalized = value.trim().toUpperCase()
    return normalized || null
  }
  if (value && typeof value === 'object' && 'value' in (value as Record<string, unknown>)) {
    return normalizeIfcTypeValue((value as { value?: unknown }).value)
  }
  return null
}

export const resolveIfcTypeFromProperties = (properties: any): string | null => {
  const candidates = [
    properties?.ifcClass,
    properties?.type,
    properties?._category,
    properties?.category,
    properties?.ObjectType,
    properties?.PredefinedType
  ]
  for (const candidate of candidates) {
    const normalized = normalizeIfcTypeValue(candidate)
    if (normalized) return normalized
  }
  return null
}

export const parseIfcReferenceId = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.trunc(value)
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) {
      return Math.trunc(parsed)
    }
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      const parsed = parseIfcReferenceId(entry)
      if (parsed !== null) return parsed
    }
    return null
  }
  if (!value || typeof value !== 'object') return null

  const candidate = value as Record<string, unknown>
  const keys = ['value', 'expressID', 'expressId', 'localId', 'id']
  for (const key of keys) {
    if (!(key in candidate)) continue
    const parsed = parseIfcReferenceId(candidate[key])
    if (parsed !== null) return parsed
  }
  return null
}

export const resolveIfcEntityKind = (value: unknown): string | null => {
  if (!value || typeof value !== 'object') return null
  const item = value as Record<string, unknown>
  const candidates = [item.type, item.ifcClass, item._category, item.category]
  for (const candidate of candidates) {
    const normalized = normalizeIfcTypeValue(candidate)
    if (normalized) return normalized
  }
  return null
}

export const resolveContainedSpaceIdFromRelation = (relation: unknown): number | null => {
  if (!relation || typeof relation !== 'object') return null
  const relationObj = relation as Record<string, unknown>
  const relationType = resolveIfcEntityKind(relationObj)
  if (relationType && relationType !== 'IFCRELCONTAINEDINSPATIALSTRUCTURE') return null
  const spaceCandidate =
    relationObj.RelatingStructure ??
    relationObj.relatingStructure ??
    relationObj.RelatedStructure ??
    relationObj.relatedStructure
  return parseIfcReferenceId(spaceCandidate)
}

export const resolveContainedSpaceId = (properties: any): number | null => {
  const relationCandidates = [
    properties?.ContainedInStructure,
    properties?.containedInStructure,
    properties?.IsContainedIn,
    properties?.isContainedIn
  ]
  const relations: unknown[] = []
  relationCandidates.forEach((candidate) => {
    if (candidate === undefined || candidate === null) return
    if (Array.isArray(candidate)) {
      relations.push(...candidate)
    } else {
      relations.push(candidate)
    }
  })

  for (const relation of relations) {
    const spaceId = resolveContainedSpaceIdFromRelation(relation)
    if (spaceId !== null) return spaceId
  }

  return null
}

export const collectContainedRelationIds = (properties: any): number[] => {
  const relationCandidates = [
    properties?.ContainedInStructure,
    properties?.containedInStructure,
    properties?.IsContainedIn,
    properties?.isContainedIn
  ]
  const relations: unknown[] = []
  relationCandidates.forEach((candidate) => {
    if (candidate === undefined || candidate === null) return
    if (Array.isArray(candidate)) {
      relations.push(...candidate)
    } else {
      relations.push(candidate)
    }
  })

  const relationIds: number[] = []
  for (const relation of relations) {
    const relationId = parseIfcReferenceId(relation)
    if (relationId !== null) {
      relationIds.push(relationId)
    }
  }
  return relationIds
}

export const extractRoomNumber = (properties: any): string | null => {
  const psets = Array.isArray(properties?.psets) ? properties.psets : []
  for (const pset of psets) {
    const props = Array.isArray(pset?.HasProperties) ? pset.HasProperties : []
    for (const prop of props) {
      const rawName = normalizeIfcValue(prop?.Name)
      if (!rawName) continue
      const normalizedName = normalizePropertyKey(rawName)
      if (!ROOM_NUMBER_KEYS.has(normalizedName)) continue
      const rawValue =
        prop?.NominalValue ?? prop?.Value ?? prop?.value ?? prop?.RealValue ?? prop?.IntegerValue ?? prop
      const resolved = normalizeIfcValue(rawValue)
      if (resolved) return resolved
    }
  }
  return null
}

export const parseCubeId = (id: string): number | null => {
  const trimmed = id.trim()
  if (!trimmed) return null

  if (trimmed.startsWith(CUBE_ITEM_PREFIX)) {
    const parsed = Number(trimmed.slice(CUBE_ITEM_PREFIX.length))
    return Number.isFinite(parsed) ? parsed : null
  }

  const legacyMatch = trimmed.match(/(?:cube[-_:]?)?(\d+)$/i)
  if (!legacyMatch) return null

  const parsed = Number(legacyMatch[1])
  return Number.isFinite(parsed) ? parsed : null
}

export const sanitizeMetadataEntries = (entries: MetadataEntry[]): MetadataEntry[] => {
  return entries
    .filter((entry) => entry && typeof entry.ifcId === 'number')
    .map((entry) => {
      const sanitizedCustom: Record<string, string> = {}
      if (entry.custom) {
        Object.entries(entry.custom).forEach(([key, value]) => {
          if (typeof value === 'string') {
            sanitizedCustom[key] = value
          }
        })
      }
      const resolvedType = typeof entry.type === 'string' ? entry.type : undefined
      const resolvedMoveDelta =
        entry.moveDelta &&
        Number.isFinite(entry.moveDelta.x) &&
        Number.isFinite(entry.moveDelta.y) &&
        Number.isFinite(entry.moveDelta.z)
          ? {
              x: Number(entry.moveDelta.x),
              y: Number(entry.moveDelta.y),
              z: Number(entry.moveDelta.z)
            }
          : undefined
      const resolvedRotation =
        entry.rotation &&
        Number.isFinite(entry.rotation.x) &&
        Number.isFinite(entry.rotation.y) &&
        Number.isFinite(entry.rotation.z)
          ? {
              x: Number(entry.rotation.x),
              y: Number(entry.rotation.y),
              z: Number(entry.rotation.z)
            }
          : undefined
      const resolvedRotateDelta =
        entry.rotateDelta &&
        Number.isFinite(entry.rotateDelta.x) &&
        Number.isFinite(entry.rotateDelta.y) &&
        Number.isFinite(entry.rotateDelta.z)
          ? {
              x: Number(entry.rotateDelta.x),
              y: Number(entry.rotateDelta.y),
              z: Number(entry.rotateDelta.z)
            }
          : undefined
      return {
        ...entry,
        type: resolvedType,
        custom: sanitizedCustom,
        moveDelta: resolvedMoveDelta,
        rotation: resolvedRotation,
        rotateDelta: resolvedRotateDelta
      }
    })
}

export const sanitizeHistoryEntries = (entries: HistoryEntry[]): HistoryEntry[] => {
  return entries
    .filter((entry) => entry && typeof entry.ifcId === 'number' && typeof entry.label === 'string')
    .map((entry) => ({
      ...entry,
      timestamp: typeof entry.timestamp === 'string' ? entry.timestamp : new Date().toISOString()
    }))
}
