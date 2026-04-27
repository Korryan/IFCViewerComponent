import { Matrix4 } from 'three'
import { IFC_LOADER_SETTINGS } from './ifcViewer.constants'
import {
  collectLoadedIfcModelIds,
  purgeIfcVisuals,
  removeIfcModelSafely
} from './ifcViewer.modelCleanup'
import { IfcViewerAPI } from './viewer/IfcViewerAPICompat'

export type Loader = (viewer: IfcViewerAPI) => Promise<any>

export type IfcLoaderManagerLike = {
  applyWebIfcConfig?: (settings: {
    COORDINATE_TO_ORIGIN?: boolean
    USE_FAST_BOOLS?: boolean
  }) => Promise<void>
  ifcAPI?: {
    GetCoordinationMatrix?: (modelID: number) => Promise<number[]> | number[]
  }
}

export type IfcLoadFacadeLike = {
  loadIfc?: (file: File, fitToFrame?: boolean) => Promise<any>
  loadIfcUrl?: (url: string, fitToFrame?: boolean) => Promise<any>
  applyWebIfcConfig?: (settings: {
    COORDINATE_TO_ORIGIN?: boolean
    USE_FAST_BOOLS?: boolean
  }) => Promise<void>
  loader?: {
    ifcManager?: IfcLoaderManagerLike
  }
  context?: {
    items?: { ifcModels?: unknown[] }
    fitToFrame?: () => void
  }
}

export type IfcLoadSource = {
  file?: File
  url?: string
}

export type LoadedIfcModel = {
  model: any
  ifcText: string | null
  inverseCoordinationMatrix: number[] | null
}

// This reads the IFC source text so later tree fallbacks can inspect raw model content.
const readIfcSourceText = async (source: IfcLoadSource): Promise<string | null> => {
  if (source.file) {
    return source.file.text()
  }
  if (!source.url) {
    return null
  }
  const response = await fetch(source.url)
  if (!response.ok) {
    return null
  }
  return response.text()
}

// This resolves the inverse coordination matrix used to translate viewer-space edits back into IFC space.
const readInverseCoordinationMatrix = async (
  ifcManager: IfcLoaderManagerLike | undefined,
  model: any
): Promise<number[] | null> => {
  const modelId =
    typeof (model as { modelID?: unknown }).modelID === 'number'
      ? ((model as { modelID: number }).modelID as number)
      : null
  const getCoordinationMatrix = ifcManager?.ifcAPI?.GetCoordinationMatrix

  if (modelId === null || typeof getCoordinationMatrix !== 'function') {
    return null
  }

  try {
    const rawMatrix = await Promise.resolve(getCoordinationMatrix(modelId))
    if (!Array.isArray(rawMatrix) || rawMatrix.length !== 16) {
      return null
    }
    const matrix = new Matrix4().fromArray(rawMatrix.map((value) => Number(value) || 0))
    if (Math.abs(matrix.determinant()) <= 1e-12) {
      return null
    }
    return matrix.clone().invert().toArray()
  } catch (error) {
    console.warn('Failed to read IFC coordination matrix', error)
    return null
  }
}

// This loads an IFC model with stable origin settings and returns the auxiliary data needed by the editor.
export const loadIfcModelWithSettings = async (args: {
  viewer: IfcViewerAPI
  source: IfcLoadSource
  fitToFrame: boolean
}): Promise<LoadedIfcModel | null> => {
  const { viewer, source, fitToFrame } = args
  const ifc = viewer.IFC as unknown as IfcLoadFacadeLike
  const ifcManager = ifc.loader?.ifcManager

  try {
    await ifc.applyWebIfcConfig?.(IFC_LOADER_SETTINGS)
  } catch (error) {
    console.warn('Failed to apply IFC loader settings', error)
  }

  if ((source.file && typeof ifc.loadIfc !== 'function') || (source.url && typeof ifc.loadIfcUrl !== 'function')) {
    return null
  }

  let ifcText: string | null = null
  try {
    ifcText = await readIfcSourceText(source)
  } catch (error) {
    console.warn('Failed to read IFC source text for room-number fallback', error)
  }

  const model = source.file
    ? await ifc.loadIfc?.(source.file, fitToFrame)
    : source.url
      ? await ifc.loadIfcUrl?.(source.url, fitToFrame)
      : null
  if (!model) return null

  const inverseCoordinationMatrix = await readInverseCoordinationMatrix(ifcManager, model)
  return {
    model,
    ifcText,
    inverseCoordinationMatrix
  }
}

// This removes all loaded IFC meshes so a new load always starts from a clean scene.
export const clearLoadedViewerModels = (args: {
  viewer: IfcViewerAPI
  lastModelId: number | null
  clearOffsetArtifacts: (modelID?: number) => void
}) => {
  const { viewer, lastModelId, clearOffsetArtifacts } = args
  const loadedModelIds = collectLoadedIfcModelIds(viewer, lastModelId)
  loadedModelIds.forEach((modelID) => {
    clearOffsetArtifacts(modelID)
    removeIfcModelSafely(viewer, modelID)
  })
  purgeIfcVisuals(viewer, loadedModelIds)
}
