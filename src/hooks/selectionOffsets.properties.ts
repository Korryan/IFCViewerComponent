import type { PropertyField } from '../ifcViewerTypes'

// Normalizes raw IFC values into readable strings for the inspector panel.
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

// Builds the trimmed property-field list shown in the properties panel for an IFC element.
export const buildPropertyFields = (rawProperties: any): PropertyField[] => {
  if (!rawProperties) {
    return []
  }

  const fields: PropertyField[] = []
  const preferredKeys = [
    'GlobalId',
    'Name',
    'Description',
    'ObjectType',
    'PredefinedType',
    'Tag'
  ]

  const seenKeys = new Set<string>()
  const addField = (key: string, label: string, rawValue: any) => {
    const normalized = normalizeIfcValue(rawValue)
    if (normalized === '' && normalized !== rawValue) {
      return
    }
    const uniqueKey = seenKeys.has(key) ? `${key}-${seenKeys.size}` : key
    seenKeys.add(uniqueKey)
    fields.push({
      key: uniqueKey,
      label,
      value: normalized
    })
  }

  preferredKeys.forEach((key) => {
    if (rawProperties[key] !== undefined) {
      addField(key, key, rawProperties[key])
    }
  })

  Object.entries(rawProperties).forEach(([key, value]) => {
    if (preferredKeys.includes(key)) {
      return
    }
    if (
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean'
    ) {
      addField(key, key, value)
    } else if (value && typeof value === 'object' && 'value' in value) {
      addField(key, key, value)
    }
  })

  if (Array.isArray(rawProperties.psets)) {
    rawProperties.psets.forEach((pset: any, psetIndex: number) => {
      const setName = normalizeIfcValue(pset?.Name) || `Property Set ${psetIndex + 1}`
      const properties = Array.isArray(pset?.HasProperties) ? pset.HasProperties : []
      properties.forEach((prop: any, propIndex: number) => {
        const propName = normalizeIfcValue(prop?.Name) || `Property ${propIndex + 1}`
        const propValue =
          prop?.NominalValue ??
          prop?.LengthValue ??
          prop?.AreaValue ??
          prop?.VolumeValue ??
          prop?.BooleanValue ??
          prop?.IntegerValue ??
          prop?.RealValue ??
          prop?.Value ??
          prop

        const key = `pset-${pset?.expressID ?? psetIndex}-${prop?.expressID ?? propIndex}`
        addField(key, `${setName} / ${propName}`, propValue)
      })
    })
  }

  return fields.slice(0, 60)
}
