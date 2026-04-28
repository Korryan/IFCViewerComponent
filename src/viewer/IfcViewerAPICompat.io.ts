import {
  registerLoadedModelRecord,
  resolveGeometryMaterialsByLocalId,
  resolveMaterialsByLocalId
} from './IfcViewerAPICompat.models'
import { getNameFromUrl, makeModelKey } from './IfcViewerAPICompat.loader'
import { createModelRecordFromBuffer } from './IfcViewerAPICompat.loadingFlow'
import type { Mesh } from 'three'
import type { IfcModelLike, ModelRecord } from './IfcViewerAPICompat.types'

type LoadModelFromBufferArgs = {
  buffer: ArrayBuffer
  sourceName: string
  fitToFrame?: boolean
  allocateModelId: () => number
  ifcLoader: any
  fragmentsManager: any
  mesher: any
  ensureIfcLoaderReady: () => Promise<void>
  modelsById: Map<number, ModelRecord>
  modelIdByKey: Map<string, number>
  ifcManagerState: { models: Record<number, { mesh: Mesh }> }
  addIfcModel: (mesh: IfcModelLike) => void
  fitToFrameNow: () => Promise<void>
  buildMeshFromCache: (record: ModelRecord, ids: number[]) => Mesh | null
}

type LoadModelFromFileArgs = {
  file: File
  fitToFrame?: boolean
  loadFromBuffer: (buffer: ArrayBuffer, sourceName: string, fitToFrame?: boolean) => Promise<IfcModelLike | null>
}

type LoadModelFromUrlArgs = {
  url: string
  fitToFrame?: boolean
  loadFromBuffer: (buffer: ArrayBuffer, sourceName: string, fitToFrame?: boolean) => Promise<IfcModelLike | null>
}

// Loads one IFC file object into the compatibility viewer.
export const loadModelFromFile = async ({
  file,
  fitToFrame = true,
  loadFromBuffer
}: LoadModelFromFileArgs): Promise<IfcModelLike | null> => {
  const buffer = await file.arrayBuffer()
  return loadFromBuffer(buffer, file.name, fitToFrame)
}

// Loads one IFC URL into the compatibility viewer through an ArrayBuffer round-trip.
export const loadModelFromUrl = async ({
  url,
  fitToFrame = true,
  loadFromBuffer
}: LoadModelFromUrlArgs): Promise<IfcModelLike | null> => {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Failed to load IFC from URL: ${url}`)
  }
  const buffer = await response.arrayBuffer()
  return loadFromBuffer(buffer, getNameFromUrl(url), fitToFrame)
}

// Loads one IFC buffer into fragments, registers caches, and optionally fits the camera.
export const loadModelFromBuffer = async ({
  buffer,
  sourceName,
  fitToFrame = true,
  allocateModelId,
  ifcLoader,
  fragmentsManager,
  mesher,
  ensureIfcLoaderReady,
  modelsById,
  modelIdByKey,
  ifcManagerState,
  addIfcModel,
  fitToFrameNow,
  buildMeshFromCache
}: LoadModelFromBufferArgs): Promise<IfcModelLike | null> => {
  const record = await createModelRecordFromBuffer({
    buffer,
    sourceName,
    numericId: allocateModelId(),
    ifcLoader,
    fragmentsManager,
    mesher,
    ensureIfcLoaderReady,
    makeModelKey,
    resolveMaterialsByLocalId,
    resolveGeometryMaterialsByLocalId,
    buildMeshFromCache
  })
  if (!record) return null

  registerLoadedModelRecord({
    record,
    modelsById,
    modelIdByKey,
    ifcManagerState
  })

  addIfcModel(record.mesh)

  if (fitToFrame) {
    await fitToFrameNow()
  }

  return record.mesh
}
