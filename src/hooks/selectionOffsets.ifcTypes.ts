import type { IfcViewerAPI } from '../viewer/IfcViewerAPICompat'

export type SelectionTypeFilterOptions = {
  allowedIfcTypes?: string[]
}

// This function normalizes IFC type names into the uppercase form used by the selection filter.
export const normalizeIfcTypeName = (value: unknown): string | null => {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed ? trimmed.toUpperCase() : null
}

// This function resolves the IFC type for one element through the fast manager path and then property fallback.
export const resolveIfcTypeName = async (
  viewer: IfcViewerAPI,
  modelID: number,
  expressID: number
): Promise<string | null> => {
  try {
    const manager = viewer.IFC?.loader?.ifcManager as
      | { getIfcType?: (idModel: number, idExpress: number) => string | undefined }
      | undefined
    const directType = manager?.getIfcType?.(modelID, expressID)
    if (directType) {
      return normalizeIfcTypeName(directType)
    }

    const props = await viewer.IFC.getProperties(modelID, expressID, false, false)
    return normalizeIfcTypeName(
      typeof props?.ifcClass === 'string'
        ? props.ifcClass
        : typeof props?.type === 'string'
          ? props.type
          : null
    )
  } catch (err) {
    console.warn('Failed to resolve IFC type for selection filter', expressID, err)
    return null
  }
}

// This function checks whether an IFC element matches the optional type whitelist for the current selection flow.
export const isIfcSelectionAllowed = async (
  viewer: IfcViewerAPI,
  modelID: number,
  expressID: number,
  options?: SelectionTypeFilterOptions
): Promise<boolean> => {
  const allowedIfcTypes = options?.allowedIfcTypes
  if (!allowedIfcTypes || allowedIfcTypes.length === 0) {
    return true
  }

  const normalizedAllowed = new Set(
    allowedIfcTypes
      .map((typeName) => normalizeIfcTypeName(typeName))
      .filter((typeName): typeName is string => Boolean(typeName))
  )
  if (normalizedAllowed.size === 0) {
    return true
  }

  const resolvedType = await resolveIfcTypeName(viewer, modelID, expressID)
  return Boolean(resolvedType && normalizedAllowed.has(resolvedType))
}
