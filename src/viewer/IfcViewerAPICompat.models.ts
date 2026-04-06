import type { FragmentsModel, MaterialDefinition, MeshData, RawMaterial, RawSample } from '@thatopen/fragments'
import { BufferGeometry, Float32BufferAttribute, Material, Matrix4, Mesh } from 'three'
import { MATERIAL_GEOMETRY_BATCH_SIZE, MATERIAL_LOOKUP_BATCH_SIZE, materialFromDefinition, materialFromRawMaterial, uniqueNumbers } from './IfcViewerAPICompat.materials'

export type CachedGeometrySlice = {
  geometry: BufferGeometry
  material: Material | Material[]
}

export type ViewerModelRecordLike = {
  numericId: number
  modelKey: string
  mesh: Mesh & { modelID?: number; __modelKey?: string }
  fragments: FragmentsModel
  expressIds: Set<number>
  geometryCache: Map<number, CachedGeometrySlice[]>
  subsets: Map<string, { ids: Set<number>; mesh: Mesh }>
  ifcTypeCache: Map<number, string>
}

// Resolves per-item IFC material definitions into a local-id to Three.js material lookup.
export const resolveMaterialsByLocalId = async (
  fragments: FragmentsModel,
  localIds: number[]
): Promise<Map<number, Material>> => {
  const byLocalId = new Map<number, Material>()
  const dedupMaterials = new Map<string, Material>()
  const ids = uniqueNumbers(localIds)
  if (ids.length === 0) return byLocalId

  for (let start = 0; start < ids.length; start += MATERIAL_LOOKUP_BATCH_SIZE) {
    const batch = ids.slice(start, start + MATERIAL_LOOKUP_BATCH_SIZE)
    let definitions: Array<{ definition: MaterialDefinition; localIds: number[] }> = []

    try {
      definitions = (await fragments.getItemsMaterialDefinition(batch)) ?? []
    } catch (error) {
      console.warn('Failed to resolve IFC material definitions; using fallback material.', error)
      continue
    }

    for (const entry of definitions) {
      const material = materialFromDefinition(entry?.definition, dedupMaterials)
      if (!material) continue

      for (const rawLocalId of entry.localIds ?? []) {
        const localId = Number(rawLocalId)
        if (!Number.isFinite(localId)) continue
        byLocalId.set(Math.trunc(localId), material)
      }
    }
  }

  return byLocalId
}

// Resolves per-geometry sample materials into a local-id indexed list of optional materials.
export const resolveGeometryMaterialsByLocalId = async (
  fragments: FragmentsModel,
  localIds: number[]
): Promise<Map<number, Array<Material | null>>> => {
  const byLocalId = new Map<number, Array<Material | null>>()
  const ids = uniqueNumbers(localIds)
  if (ids.length === 0) return byLocalId

  let samplesById = new Map<number, RawSample>()
  let materialsById = new Map<number, RawMaterial>()
  try {
    ;[samplesById, materialsById] = await Promise.all([fragments.getSamples(), fragments.getMaterials()])
  } catch (error) {
    console.warn('Failed to read IFC sample/material tables for geometry colors.', error)
    return byLocalId
  }

  const dedupMaterials = new Map<string, Material>()
  for (let start = 0; start < ids.length; start += MATERIAL_GEOMETRY_BATCH_SIZE) {
    const batch = ids.slice(start, start + MATERIAL_GEOMETRY_BATCH_SIZE)
    let geometryRows: MeshData[][] = []
    try {
      geometryRows = (await fragments.getItemsGeometry(batch)) ?? []
    } catch (error) {
      console.warn('Failed to read IFC item geometry for material mapping.', error)
      continue
    }

    batch.forEach((localId, rowIndex) => {
      const row = Array.isArray(geometryRows[rowIndex]) ? geometryRows[rowIndex] : []
      const rowMaterials: Array<Material | null> = []

      row.forEach((meshData) => {
        const sampleId = Number((meshData as any)?.sampleId)
        if (!Number.isFinite(sampleId)) {
          rowMaterials.push(null)
          return
        }
        const sample = samplesById.get(Math.trunc(sampleId))
        const materialId = Number((sample as any)?.material)
        if (!Number.isFinite(materialId)) {
          rowMaterials.push(null)
          return
        }
        const rawMaterial = materialsById.get(Math.trunc(materialId))
        rowMaterials.push(materialFromRawMaterial(rawMaterial, dedupMaterials))
      })

      byLocalId.set(localId, rowMaterials)
    })
  }

  return byLocalId
}

// Builds a stable deduplication key for one meshed geometry instance and its transform/material combination.
export const makeGeometryInstanceKey = (
  geometry: BufferGeometry,
  matrix?: Matrix4,
  material?: Material | Material[] | null
): string => {
  if (!matrix) return `${geometry.uuid}|identity`

  const matrixKey = matrix.elements
    .map((value) => (Math.abs(value) < 1e-7 ? '0' : value.toFixed(6)))
    .join(',')

  let materialKey = 'no-material'
  if (Array.isArray(material)) {
    materialKey = material.length > 0 ? material.map((entry) => entry.uuid).join(',') : 'no-material'
  } else if (material) {
    materialKey = material.uuid
  }

  return `${geometry.uuid}|${matrixKey}|${materialKey}`
}

// Clones one geometry, injects a constant expressID attribute, and bakes an optional world matrix into it.
export const cloneGeometryWithExpressId = (
  source: BufferGeometry,
  expressID: number,
  worldMatrix?: Matrix4
): BufferGeometry | null => {
  let geometry = source.clone()
  if (geometry.index) {
    const nonIndexed = geometry.toNonIndexed()
    geometry.dispose()
    geometry = nonIndexed
  }

  const positions = geometry.getAttribute('position')
  if (!positions) {
    geometry.dispose()
    return null
  }

  const ids = new Float32Array(positions.count)
  ids.fill(expressID)
  geometry.setAttribute('expressID', new Float32BufferAttribute(ids, 1))

  if (worldMatrix) {
    const elements = worldMatrix.elements
    const isIdentity =
      elements[0] === 1 &&
      elements[1] === 0 &&
      elements[2] === 0 &&
      elements[3] === 0 &&
      elements[4] === 0 &&
      elements[5] === 1 &&
      elements[6] === 0 &&
      elements[7] === 0 &&
      elements[8] === 0 &&
      elements[9] === 0 &&
      elements[10] === 1 &&
      elements[11] === 0 &&
      elements[12] === 0 &&
      elements[13] === 0 &&
      elements[14] === 0 &&
      elements[15] === 1
    if (!isIdentity) {
      geometry.applyMatrix4(worldMatrix)
    }
  }

  return geometry
}

// Builds the cached per-local-id geometry slices that later power base meshes and subsets.
export const buildGeometryCache = (args: {
  localMap: Map<number, Mesh[]>
  resolvedMaterials: Map<number, Material>
  geometryResolvedMaterials: Map<number, Array<Material | null>>
}) => {
  const geometryCache = new Map<number, CachedGeometrySlice[]>()

  for (const [rawLocalId, meshes] of args.localMap as any) {
    const localId = Number(rawLocalId)
    if (!Number.isFinite(localId)) continue

    const normalizedLocalId = Math.trunc(localId)
    const resolvedMaterialForLocalId = args.resolvedMaterials.get(normalizedLocalId)
    const resolvedGeometryMaterialsForLocalId =
      args.geometryResolvedMaterials.get(normalizedLocalId) ?? []
    const seenGeometryInstances = new Set<string>()
    const entries: CachedGeometrySlice[] = []

    for (const [meshIndex, source] of (meshes as Mesh[]).entries()) {
      const sourceGeometry = source.geometry as BufferGeometry | undefined
      const sourceMaterial = source.material as Material | Material[] | undefined
      const resolvedMaterial =
        resolvedGeometryMaterialsForLocalId[meshIndex] ?? resolvedMaterialForLocalId ?? sourceMaterial
      if (!sourceGeometry || !resolvedMaterial) continue

      if (typeof source.updateMatrixWorld === 'function') {
        source.updateMatrixWorld(true)
      }
      const sourceMatrix =
        source.matrixWorld instanceof Matrix4
          ? source.matrixWorld
          : source.matrix instanceof Matrix4
            ? source.matrix
            : undefined

      const instanceKey = makeGeometryInstanceKey(sourceGeometry, sourceMatrix, resolvedMaterial)
      if (seenGeometryInstances.has(instanceKey)) {
        continue
      }
      seenGeometryInstances.add(instanceKey)

      const geometry = cloneGeometryWithExpressId(sourceGeometry, normalizedLocalId, sourceMatrix)
      if (!geometry) continue

      entries.push({
        geometry,
        material: resolvedMaterial
      })
    }

    if (entries.length > 0) {
      geometryCache.set(normalizedLocalId, entries)
    }
  }

  return geometryCache
}

// Creates a normalized model record shell around one fragments model and its cached geometry slices.
export const createViewerModelRecord = (args: {
  numericId: number
  modelKey: string
  fragments: FragmentsModel
  expressIds: number[]
  geometryCache: Map<number, CachedGeometrySlice[]>
}) => {
  const record: ViewerModelRecordLike = {
    numericId: args.numericId,
    modelKey: args.modelKey,
    mesh: null as unknown as Mesh & { modelID?: number; __modelKey?: string },
    fragments: args.fragments,
    expressIds: new Set(args.expressIds),
    geometryCache: args.geometryCache,
    subsets: new Map(),
    ifcTypeCache: new Map()
  }
  return record
}

// Finalizes the model record by attaching the rendered base mesh and its model identifiers.
export const attachBaseMeshToModelRecord = <T extends ViewerModelRecordLike>(
  record: T,
  mesh: Mesh
) => {
  record.mesh = mesh as T['mesh']
  record.mesh.modelID = record.numericId
  record.mesh.__modelKey = record.modelKey
  return record
}

// Registers one fully built model record into the viewer maps and legacy ifcManager state.
export const registerLoadedModelRecord = <T extends ViewerModelRecordLike>(args: {
  record: T
  modelsById: Map<number, T>
  modelIdByKey: Map<string, number>
  ifcManagerState: { models: Record<number, { mesh: Mesh }> }
}) => {
  args.modelsById.set(args.record.numericId, args.record)
  args.modelIdByKey.set(args.record.modelKey, args.record.numericId)
  args.ifcManagerState.models[args.record.numericId] = { mesh: args.record.mesh }
}
