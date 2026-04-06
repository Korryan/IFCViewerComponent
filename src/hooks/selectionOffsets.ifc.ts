import { FrontSide, Matrix4, Vector3 } from 'three'

// Reads a single finite numeric value from raw IFC property payloads.
const readIfcNumericValue = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Number(value)
  }
  if (typeof value === 'string') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  if (value && typeof value === 'object' && 'value' in value) {
    return readIfcNumericValue((value as { value?: unknown }).value)
  }
  return null
}

// Extracts a numeric tuple from IFC coordinate or direction payloads.
const readIfcNumberTuple = (value: unknown): number[] | null => {
  if (Array.isArray(value)) {
    const parsed = value
      .map((entry) => readIfcNumericValue(entry))
      .filter((entry): entry is number => entry !== null)
    return parsed.length > 0 ? parsed : null
  }
  if (!value || typeof value !== 'object') return null

  const candidate = value as {
    value?: unknown
    Coordinates?: unknown
    DirectionRatios?: unknown
  }
  return (
    readIfcNumberTuple(candidate.Coordinates) ??
    readIfcNumberTuple(candidate.DirectionRatios) ??
    readIfcNumberTuple(candidate.value)
  )
}

// Unwraps the nested value wrapper used by many IFC JSON entities.
const unwrapIfcEntity = (value: unknown): Record<string, any> | null => {
  if (!value || typeof value !== 'object') return null
  const candidate = value as { value?: unknown }
  if (candidate.value && typeof candidate.value === 'object' && !Array.isArray(candidate.value)) {
    return candidate.value as Record<string, any>
  }
  return value as Record<string, any>
}

// Builds a transform matrix for one IFC axis placement definition.
const buildAxisPlacementMatrix = (value: unknown): Matrix4 | null => {
  const placement = unwrapIfcEntity(value)
  if (!placement) return null

  const locationTuple = readIfcNumberTuple(placement.Location ?? placement)
  if (!locationTuple || locationTuple.length < 2) {
    return null
  }

  const origin = new Vector3(
    locationTuple[0] ?? 0,
    locationTuple[1] ?? 0,
    locationTuple[2] ?? 0
  )

  const axisTuple = readIfcNumberTuple(placement.Axis) ?? [0, 0, 1]
  const refTuple = readIfcNumberTuple(placement.RefDirection) ?? [1, 0, 0]

  const zAxis = new Vector3(axisTuple[0] ?? 0, axisTuple[1] ?? 0, axisTuple[2] ?? 1)
  if (zAxis.lengthSq() <= 1e-12) {
    zAxis.set(0, 0, 1)
  } else {
    zAxis.normalize()
  }

  const xAxis = new Vector3(refTuple[0] ?? 1, refTuple[1] ?? 0, refTuple[2] ?? 0)
  if (xAxis.lengthSq() <= 1e-12) {
    xAxis.set(1, 0, 0)
  }
  xAxis.addScaledVector(zAxis, -xAxis.dot(zAxis))
  if (xAxis.lengthSq() <= 1e-12) {
    const fallback = Math.abs(zAxis.z) < 0.99 ? new Vector3(0, 0, 1) : new Vector3(0, 1, 0)
    xAxis.copy(fallback).cross(zAxis)
  }
  xAxis.normalize()

  const yAxis = new Vector3().crossVectors(zAxis, xAxis)
  if (yAxis.lengthSq() <= 1e-12) {
    yAxis.set(0, 1, 0)
  } else {
    yAxis.normalize()
  }

  xAxis.crossVectors(yAxis, zAxis).normalize()

  const matrix = new Matrix4().makeBasis(xAxis, yAxis, zAxis)
  matrix.setPosition(origin)
  return matrix
}

// Reconstructs the full placement chain for an IFC product into one world matrix.
export const buildObjectPlacementMatrix = (
  value: unknown,
  depth = 0,
  seen = new WeakSet<object>()
): Matrix4 | null => {
  const placement = unwrapIfcEntity(value)
  if (!placement) return null
  if (depth > 24) return null
  if (seen.has(placement)) return null

  seen.add(placement)
  try {
    const localMatrix = buildAxisPlacementMatrix(placement.RelativePlacement ?? placement)
    if (!localMatrix) return null

    const parentPlacement = unwrapIfcEntity(placement.PlacementRelTo)
    if (!parentPlacement) {
      return localMatrix
    }

    const parentMatrix = buildObjectPlacementMatrix(parentPlacement, depth + 1, seen)
    if (!parentMatrix) {
      return localMatrix
    }

    return parentMatrix.multiply(localMatrix)
  } finally {
    seen.delete(placement)
  }
}

// Restores the render-state flags that keep IFC materials stable in the viewer.
const tuneIfcMeshMaterial = (
  material:
    | {
        side?: number
        depthTest?: boolean
        depthWrite?: boolean
        transparent?: boolean
        polygonOffset?: boolean
        polygonOffsetFactor?: number
        polygonOffsetUnits?: number
        needsUpdate?: boolean
      }
    | null
    | undefined
) => {
  if (!material) return
  material.side = FrontSide
  material.depthTest = true
  material.depthWrite = true
  material.polygonOffset = false
  material.polygonOffsetFactor = 0
  material.polygonOffsetUnits = 0
  material.needsUpdate = true
}

// Traverses an IFC model and normalizes every material used by its meshes.
export const tuneIfcModelMaterials = (model: unknown) => {
  if (!model) return
  const stack: Array<
    {
      material?:
        | {
            side?: number
            depthTest?: boolean
            depthWrite?: boolean
            transparent?: boolean
            polygonOffset?: boolean
            polygonOffsetFactor?: number
            polygonOffsetUnits?: number
            needsUpdate?: boolean
          }
        | Array<{
            side?: number
            depthTest?: boolean
            depthWrite?: boolean
            transparent?: boolean
            polygonOffset?: boolean
            polygonOffsetFactor?: number
            polygonOffsetUnits?: number
            needsUpdate?: boolean
          }>
      children?: unknown[]
    }
  > = [
    model as {
      material?:
        | {
            side?: number
            depthTest?: boolean
            depthWrite?: boolean
            transparent?: boolean
            polygonOffset?: boolean
            polygonOffsetFactor?: number
            polygonOffsetUnits?: number
            needsUpdate?: boolean
          }
        | Array<{
            side?: number
            depthTest?: boolean
            depthWrite?: boolean
            transparent?: boolean
            polygonOffset?: boolean
            polygonOffsetFactor?: number
            polygonOffsetUnits?: number
            needsUpdate?: boolean
          }>
      children?: unknown[]
    }
  ]
  while (stack.length > 0) {
    const current = stack.pop()
    if (!current) continue
    if (Array.isArray(current.material)) {
      current.material.forEach((material) => tuneIfcMeshMaterial(material))
    } else {
      tuneIfcMeshMaterial(current.material)
    }
    if (Array.isArray(current.children) && current.children.length > 0) {
      current.children.forEach((child) =>
        stack.push(
          child as {
            material?:
              | {
                  side?: number
                  depthTest?: boolean
                  depthWrite?: boolean
                  transparent?: boolean
                  polygonOffset?: boolean
                  polygonOffsetFactor?: number
                  polygonOffsetUnits?: number
                  needsUpdate?: boolean
                }
              | Array<{
                  side?: number
                  depthTest?: boolean
                  depthWrite?: boolean
                  transparent?: boolean
                  polygonOffset?: boolean
                  polygonOffsetFactor?: number
                  polygonOffsetUnits?: number
                  needsUpdate?: boolean
                }>
            children?: unknown[]
          }
        )
      )
    }
  }
}
