import { ROOM_NUMBER_KEYS } from './ifcViewer.constants'

// Normalizes raw IFC values into readable strings for UI fields and metadata extraction.
export const normalizeIfcValue = (rawValue: any): string => {
  if (rawValue === null || rawValue === undefined) {
    return ''
  }
  if (typeof rawValue === 'string') {
    return rawValue
  }
  if (typeof rawValue === 'number' || typeof rawValue === 'boolean') {
    return String(rawValue)
  }
  if (Array.isArray(rawValue)) {
    return rawValue.map((entry) => normalizeIfcValue(entry)).join(', ')
  }
  if (typeof rawValue === 'object') {
    if ('value' in rawValue) {
      return normalizeIfcValue(rawValue.value)
    }
    if ('Name' in rawValue && typeof rawValue.Name === 'string') {
      return rawValue.Name
    }
    return ''
  }
  return String(rawValue)
}

// Normalizes one property key into the format used by room-number matching.
const normalizePropertyKey = (value: string): string =>
  value.toLowerCase().replace(/[\s_-]+/g, '')

// Normalizes one IFC type-like scalar into an uppercase entity name.
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

// Resolves the best IFC entity type candidate from one properties object.
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

// Parses one IFC reference payload into a numeric express id when possible.
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

// Resolves the IFC entity type carried by one relation or property object.
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

// Extracts the room number from IFC property sets when a supported property key is present.
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
