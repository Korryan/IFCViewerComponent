const MAX_LEGACY_ITEM_DEPTH = 32
const MAX_PROPERTYSET_SCAN_NODES = 6000

// Resolves the best available IFC/spatial type label from a raw fragments item.
export const resolveSpatialType = (item: any): string => {
  const candidates = [item?._category, item?.category, item?.ifcClass, item?.type]
  for (const candidate of candidates) {
    if (typeof candidate === 'string') {
      const value = candidate.trim()
      if (value) return value.toUpperCase()
    }
    if (candidate && typeof candidate === 'object' && typeof (candidate as any).value === 'string') {
      const value = (candidate as any).value.trim()
      if (value) return value.toUpperCase()
    }
  }
  return 'UNKNOWN'
}

// Normalizes one possible spatial id value into a finite integer express id.
export const parseSpatialIdCandidate = (raw: unknown): number | undefined => {
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
    return parseSpatialIdCandidate((raw as { value?: unknown }).value)
  }
  return undefined
}

// Collects all distinct id candidates that a spatial item exposes for selection.
export const resolveSpatialIdCandidates = (item: any): number[] => {
  const candidates = [item?.expressID, item?.expressId, item?.id, item?.localId]
  const dedup = new Set<number>()
  candidates.forEach((candidate) => {
    const parsed = parseSpatialIdCandidate(candidate)
    if (parsed !== undefined) {
      dedup.add(parsed)
    }
  })
  return Array.from(dedup)
}

// Chooses the preferred selection id for a spatial item, optionally preferring renderable ids.
export const resolveSpatialSelectionId = (
  item: any,
  renderableIds?: Set<number>
): number | undefined => {
  const candidates = resolveSpatialIdCandidates(item)
  if (candidates.length === 0) return undefined
  if (renderableIds && renderableIds.size > 0) {
    const matching = candidates.find((candidate) => renderableIds.has(candidate))
    if (matching !== undefined) return matching
  }
  return candidates[0]
}

// Resolves the most useful display name for a spatial item from raw or wrapped string values.
export const resolveSpatialName = (item: any): string | undefined => {
  const candidates = [item?.name, item?.Name]
  for (const candidate of candidates) {
    if (typeof candidate === 'string') {
      const value = candidate.trim()
      if (value) return value
    }
    if (candidate && typeof candidate === 'object' && typeof (candidate as any).value === 'string') {
      const value = (candidate as any).value.trim()
      if (value) return value
    }
  }
  return undefined
}

// Converts a spatial node into the legacy tree shape expected by the rest of the viewer.
export const toLegacySpatial = (item: any, renderableIds?: Set<number>): any => {
  const normalizedId = resolveSpatialSelectionId(item, renderableIds)
  return {
    expressID: normalizedId,
    localId: normalizedId,
    type: resolveSpatialType(item),
    name: resolveSpatialName(item),
    children: Array.isArray(item?.children)
      ? item.children.map((child: any) => toLegacySpatial(child, renderableIds))
      : []
  }
}

// Recursively normalizes fragments item payloads into plain legacy-compatible objects.
export const toLegacyItemData = (value: any, depth = 0, stack = new WeakSet<object>()): any => {
  if (value === null || value === undefined) return value
  if (typeof value !== 'object') return value
  if (depth > MAX_LEGACY_ITEM_DEPTH) return undefined
  if (stack.has(value as object)) return undefined

  stack.add(value as object)
  try {
    if (Array.isArray(value)) {
      return value
        .map((entry) => toLegacyItemData(entry, depth + 1, stack))
        .filter((entry) => entry !== undefined)
    }

    if ('value' in value && Object.keys(value).every((key) => key === 'value' || key === 'type')) {
      return {
        value: toLegacyItemData((value as { value: unknown }).value, depth + 1, stack),
        type:
          typeof (value as { type?: unknown }).type === 'string'
            ? (value as { type?: string }).type
            : undefined
      }
    }

    const result: Record<string, any> = {}
    Object.entries(value).forEach(([key, entry]) => {
      if (typeof entry === 'function') return
      const normalized = toLegacyItemData(entry, depth + 1, stack)
      if (normalized !== undefined) {
        result[key] = normalized
      }
    })
    return result
  } finally {
    stack.delete(value as object)
  }
}

// Reads a raw or wrapped string value while trimming empty content to null.
export const readRawString = (value: unknown): string | null => {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed || null
  }
  if (!value || typeof value !== 'object') return null

  const wrapped = value as { value?: unknown }
  if (typeof wrapped.value === 'string') {
    const trimmed = wrapped.value.trim()
    return trimmed || null
  }
  return null
}

// Resolves the best IFC category name from raw fragments data and its normalized clone.
export const resolveCategoryFromData = (rawData: any, normalized: any): string | null => {
  const candidates = [
    rawData?._category,
    rawData?.ifcClass,
    rawData?.category,
    rawData?.type,
    normalized?._category,
    normalized?.ifcClass,
    normalized?.category,
    normalized?.type
  ]

  for (const candidate of candidates) {
    const resolved = readRawString(candidate)
    if (resolved) {
      return resolved.toUpperCase()
    }
  }
  return null
}

// Recursively collects IFC property set objects from a normalized fragments payload within a scan budget.
export const gatherPropertySets = (
  value: any,
  acc: any[],
  seen: Set<any>,
  budget: { remaining: number } = { remaining: MAX_PROPERTYSET_SCAN_NODES }
) => {
  if (budget.remaining <= 0) return
  budget.remaining -= 1
  if (!value || typeof value !== 'object' || seen.has(value)) return
  seen.add(value)

  if (
    Array.isArray((value as { HasProperties?: unknown }).HasProperties) &&
    (typeof (value as { type?: unknown }).type === 'string' ||
      typeof (value as { ifcClass?: unknown }).ifcClass === 'string' ||
      typeof (value as { category?: unknown }).category === 'string')
  ) {
    acc.push(value)
  }

  if (Array.isArray(value)) {
    value.forEach((entry) => gatherPropertySets(entry, acc, seen, budget))
    return
  }

  Object.values(value).forEach((entry) => gatherPropertySets(entry, acc, seen, budget))
}
