import type { FragmentsModel, ItemData } from '@thatopen/fragments'
import { gatherPropertySets, resolveCategoryFromData, toLegacyItemData } from './IfcViewerAPICompat.legacy'

// Builds the fragments data query config for one legacy property lookup request.
const buildItemDataConfig = (recursive: boolean, includeProperties: boolean) => {
  if (includeProperties) {
    return {
      attributesDefault: true,
      relationsDefault: {
        attributes: true,
        relations: recursive
      }
    }
  }

  return {
    attributesDefault: true,
    relationsDefault: {
      attributes: false,
      relations: false
    }
  }
}

// Loads one IFC element as legacy-style property data and expands property sets when requested.
export const loadLegacyItemProperties = async (args: {
  fragments: FragmentsModel
  expressID: number
  recursive?: boolean
  includeProperties?: boolean
  ifcTypeCache: Map<number, string>
}) => {
  const config = buildItemDataConfig(Boolean(args.recursive), Boolean(args.includeProperties))
  const rawData = await args.fragments
    .getItemsData([args.expressID], config as any)
    .then((items: ItemData[]) => (Array.isArray(items) && items.length > 0 ? items[0] : {}))
    .catch(() => ({}))

  const normalized = toLegacyItemData(rawData)
  const resolvedCategory = resolveCategoryFromData(rawData, normalized)
  if (resolvedCategory) {
    normalized.ifcClass = resolvedCategory
    normalized.type = resolvedCategory
    args.ifcTypeCache.set(args.expressID, resolvedCategory)
  }

  if (!args.includeProperties) {
    return normalized
  }

  const psets: any[] = []
  gatherPropertySets(normalized, psets, new Set())

  return {
    ...normalized,
    psets,
    typeProperties: [],
    materials: []
  }
}
