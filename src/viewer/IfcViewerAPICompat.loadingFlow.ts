import type { FragmentsModel } from '@thatopen/fragments'
import type { Material, Mesh } from 'three'
import {
  attachBaseMeshToModelRecord,
  buildGeometryCache,
  createViewerModelRecord
} from './IfcViewerAPICompat.models'
import { uniqueNumbers } from './IfcViewerAPICompat.materials'
import type { ModelRecord } from './IfcViewerAPICompat.types'

// Disposes one partially loaded fragments model without surfacing cleanup errors.
const disposeFragmentsModel = (fragmentsManager: any, modelKey: string) => {
  try {
    void fragmentsManager.core.disposeModel(modelKey)
  } catch {
    // no-op
  }
}

// Disposes every cached geometry slice created for a partially loaded model record.
const disposeGeometryCache = (geometryCache: ModelRecord['geometryCache']) => {
  geometryCache.forEach((entries) => {
    entries.forEach((entry) => entry.geometry.dispose())
  })
}

// Builds one fully meshed model record from an IFC array buffer and resolved material tables.
export const createModelRecordFromBuffer = async (args: {
  buffer: ArrayBuffer
  sourceName: string
  numericId: number
  ifcLoader: any
  fragmentsManager: any
  mesher: any
  ensureIfcLoaderReady: () => Promise<void>
  makeModelKey: (name: string) => string
  resolveMaterialsByLocalId: (
    fragments: FragmentsModel,
    localIds: number[]
  ) => Promise<Map<number, Material>>
  resolveGeometryMaterialsByLocalId: (
    fragments: FragmentsModel,
    localIds: number[]
  ) => Promise<Map<number, Array<Material | null>>>
  buildMeshFromCache: (record: ModelRecord, ids: number[]) => Mesh | null
}): Promise<ModelRecord | null> => {
  await args.ensureIfcLoaderReady()

  const modelKey = args.makeModelKey(args.sourceName)
  const fragments = (await args.ifcLoader.load(
    new Uint8Array(args.buffer),
    true,
    modelKey
  )) as FragmentsModel
  fragments.object.visible = false

  const expressIds = uniqueNumbers(await fragments.getItemsIdsWithGeometry())
  if (expressIds.length === 0) {
    disposeFragmentsModel(args.fragmentsManager, modelKey)
    return null
  }

  const modelIdMap = {
    [modelKey]: new Set(expressIds)
  }
  const mesherResult = await args.mesher.get(modelIdMap, {
    applyTransformation: true
  })

  const localMap = mesherResult.get(modelKey) as Map<number, Mesh[]> | undefined
  if (!localMap || localMap.size === 0) {
    disposeFragmentsModel(args.fragmentsManager, modelKey)
    return null
  }

  const localIds = uniqueNumbers(Array.from(localMap.keys()) as number[])
  const [resolvedMaterials, geometryResolvedMaterials] = await Promise.all([
    args.resolveMaterialsByLocalId(fragments, localIds),
    args.resolveGeometryMaterialsByLocalId(fragments, localIds)
  ])

  const geometryCache = buildGeometryCache({
    localMap,
    resolvedMaterials,
    geometryResolvedMaterials
  }) as ModelRecord['geometryCache']

  const record = createViewerModelRecord({
    numericId: args.numericId,
    modelKey,
    fragments,
    expressIds,
    geometryCache
  }) as ModelRecord

  const baseMesh = args.buildMeshFromCache(record, expressIds)
  if (!baseMesh) {
    disposeGeometryCache(geometryCache)
    disposeFragmentsModel(args.fragmentsManager, modelKey)
    return null
  }

  return attachBaseMeshToModelRecord(record, baseMesh) as ModelRecord
}
