import { toLegacySpatial } from './IfcViewerAPICompat.legacy'
import { getExpressIdFromGeometry, type PickResult } from './IfcViewerAPICompat.picking'
import type {
  IfcModelLike,
  ModelRecord,
  ViewerContextCompat,
  ViewerIfcManagerBridge,
  ViewerIfcPublicApi,
  ViewerSceneItems
} from './IfcViewerAPICompat.types'

// Builds the legacy viewer context facade consumed by the rest of the component code.
export const createViewerContextBridge = (args: {
  items: ViewerSceneItems
  cameraControls: any
  perspectiveCamera: any
  orthographicCamera: any
  mousePosition: any
  scene: any
  castRayIfcCandidates: (pointer?: any) => PickResult[]
  fitToFrame: () => Promise<void>
}): ViewerContextCompat => {
  const castRayIfc = () => {
    return args.castRayIfcCandidates()[0] ?? null
  }

  return {
    renderer: { postProduction: { active: false } },
    ifcCamera: {
      cameraControls: args.cameraControls,
      perspectiveCamera: args.perspectiveCamera,
      orthographicCamera: args.orthographicCamera
    },
    mouse: { position: args.mousePosition },
    items: args.items,
    getScene: () => args.scene,
    getCamera: () => args.perspectiveCamera,
    castRayIfc,
    castRayIfcCandidates: args.castRayIfcCandidates,
    fitToFrame: args.fitToFrame
  }
}

// Builds the legacy ifcManager bridge used by older viewer code paths.
export const createIfcManagerBridge = (args: {
  modelsById: Map<number, ModelRecord>
  getCoordinationMatrix: (modelID: number) => Promise<number[] | null>
  configureWasmPath: (path: string) => void
  applyWebIfcConfig: (settings: any) => Promise<void>
  getItemProperties: (
    modelID: number,
    expressID: number,
    recursive?: boolean,
    includeProperties?: boolean
  ) => Promise<any>
  createSubset: ViewerIfcManagerBridge['createSubset']
  removeSubset: (modelID: number, customID?: string) => void
  removeFromSubset: (modelID: number, ids: number[], customID?: string) => void
  removeIfcModel: (modelID: number) => void
  dispose: () => void
}): ViewerIfcManagerBridge => {
  return {
    state: { models: {} },
    ifcAPI: {
      GetCoordinationMatrix: (modelID: number) => args.getCoordinationMatrix(modelID)
    },
    setWasmPath: (path: string) => {
      args.configureWasmPath(path)
    },
    applyWebIfcConfig: async (settings: any) => {
      await args.applyWebIfcConfig(settings)
    },
    getCoordinationMatrix: async (modelID: number) => {
      return args.getCoordinationMatrix(modelID)
    },
    getExpressId: (geometry, faceIndex) => {
      return getExpressIdFromGeometry(geometry, faceIndex)
    },
    getIfcType: (modelID: number, expressID: number) => {
      return args.modelsById.get(modelID)?.ifcTypeCache.get(expressID)
    },
    getSpatialStructure: async (modelID: number) => {
      const record = args.modelsById.get(modelID)
      if (!record) return null
      const spatial = await record.fragments.getSpatialStructure()
      return toLegacySpatial(spatial, record.expressIds)
    },
    getItemProperties: async (modelID: number, expressID: number, recursive = false) => {
      return args.getItemProperties(modelID, expressID, recursive, false)
    },
    getPropertySets: async (modelID: number, expressID: number, recursive = false) => {
      const props = await args.getItemProperties(modelID, expressID, recursive, true)
      return Array.isArray(props?.psets) ? props.psets : []
    },
    getTypeProperties: async () => [],
    getMaterialsProperties: async () => [],
    createSubset: (config) => {
      return args.createSubset(config)
    },
    removeSubset: (modelID: number, _material?: unknown, customID?: string) => {
      args.removeSubset(modelID, customID)
    },
    removeFromSubset: (modelID: number, ids: number[], customID?: string) => {
      args.removeFromSubset(modelID, ids, customID)
    },
    close: (modelID: number) => {
      args.removeIfcModel(modelID)
    },
    dispose: async () => {
      args.dispose()
    }
  }
}

// Builds the public IFC facade exposed by the compatibility wrapper.
export const createIfcPublicApi = (args: {
  ifcManager: ViewerIfcManagerBridge
  items: ViewerSceneItems
  fitToFrame: () => Promise<void>
  configureWasmPath: (path: string) => void
  applyWebIfcConfig: (settings: any) => Promise<void>
  loadFromUrl: (url: string, fitToFrame?: boolean) => Promise<IfcModelLike | null>
  loadFromFile: (file: File, fitToFrame?: boolean) => Promise<IfcModelLike | null>
  addIfcModel: (mesh: IfcModelLike | null | undefined) => void
  removeIfcModel: (modelID: number) => void
  modelsById: Map<number, ModelRecord>
  getItemProperties: (
    modelID: number,
    expressID: number,
    recursive?: boolean,
    includeProperties?: boolean
  ) => Promise<any>
}): ViewerIfcPublicApi => {
  return {
    loader: {
      ifcManager: args.ifcManager,
      loadAsync: async (url: string) => args.loadFromUrl(url, false)
    },
    context: {
      items: args.items,
      fitToFrame: args.fitToFrame
    },
    selector: {
      pickIfcItem: async () => null,
      unpickIfcItems: () => {}
    },
    setWasmPath: async (path: string) => {
      args.configureWasmPath(path)
    },
    applyWebIfcConfig: async (settings: any) => {
      await args.applyWebIfcConfig(settings)
    },
    loadIfc: async (file: File, fitToFrame = true) => args.loadFromFile(file, fitToFrame),
    loadIfcUrl: async (url: string, fitToFrame = true) => args.loadFromUrl(url, fitToFrame),
    addIfcModel: (mesh: IfcModelLike | null | undefined) => {
      args.addIfcModel(mesh)
    },
    removeIfcModel: (modelID: number) => {
      args.removeIfcModel(modelID)
    },
    getSpatialStructure: async (modelID: number) => {
      const record = args.modelsById.get(modelID)
      if (!record) return null
      const spatial = await record.fragments.getSpatialStructure()
      return toLegacySpatial(spatial, record.expressIds)
    },
    getProperties: async (
      modelID: number,
      expressID: number,
      recursive = false,
      includeProperties = false
    ) => {
      return args.getItemProperties(modelID, expressID, recursive, includeProperties)
    }
  }
}
