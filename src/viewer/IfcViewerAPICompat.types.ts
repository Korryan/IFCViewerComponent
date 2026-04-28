import type CameraControls from 'camera-controls'
import type { FragmentsModel } from '@thatopen/fragments'
import type {
  BufferGeometry,
  Color,
  Material,
  Mesh,
  Object3D,
  OrthographicCamera,
  PerspectiveCamera,
  Scene,
  Vector2
} from 'three'
import type { PickResult } from './IfcViewerAPICompat.picking'

// Describes the supported viewer constructor options for the compatibility wrapper.
export type ViewerOptions = {
  container: HTMLElement
  backgroundColor?: Color
}

// Describes one IFC mesh instance tracked by the compatibility wrapper.
export type IfcModelLike = Mesh & {
  modelID?: number
  __modelKey?: string
  removeFromParent?: () => void
}

// Describes one cached geometry slice and its resolved render material.
export type GeometrySlice = {
  geometry: BufferGeometry
  material: Material | Material[]
}

// Describes one cached subset selection mesh and its tracked express ids.
export type SubsetRecord = {
  ids: Set<number>
  mesh: Mesh
}

// Describes one fully loaded IFC model record stored by the compatibility wrapper.
export type ModelRecord = {
  numericId: number
  modelKey: string
  mesh: IfcModelLike
  fragments: FragmentsModel
  expressIds: Set<number>
  geometryCache: Map<number, GeometrySlice[]>
  subsets: Map<string, SubsetRecord>
  ifcTypeCache: Map<number, string>
}

// Describes the scene item lists mirrored by the compatibility wrapper.
export type ViewerSceneItems = {
  ifcModels: IfcModelLike[]
  pickableIfcModels: Object3D[]
}

// Describes the legacy context facade exposed to the rest of the viewer code.
export type ViewerContextCompat = {
  renderer: { postProduction: { active: boolean } }
  ifcCamera: {
    cameraControls: CameraControls
    perspectiveCamera: PerspectiveCamera
    orthographicCamera: OrthographicCamera
  }
  mouse: { position: Vector2 }
  items: ViewerSceneItems
  getScene: () => Scene
  getCamera: () => PerspectiveCamera
  castRayIfc: () => PickResult | null
  castRayIfcCandidates: (pointer?: Vector2) => PickResult[]
  fitToFrame: () => Promise<void>
}

// Describes the legacy ifcManager bridge exposed under IFC.loader.ifcManager.
export type ViewerIfcManagerBridge = {
  state: { models: Record<number, { mesh: IfcModelLike }> }
  ifcAPI?: {
    GetCoordinationMatrix?: (modelID: number) => Promise<number[] | null> | number[] | null
  }
  setWasmPath: (path: string) => void
  applyWebIfcConfig: (settings: any) => Promise<void>
  getCoordinationMatrix: (modelID: number) => Promise<number[] | null>
  getExpressId: (geometry: BufferGeometry, faceIndex: number) => number
  getIfcType: (modelID: number, expressID: number) => string | undefined
  getSpatialStructure: (modelID: number, _includeProperties?: boolean) => Promise<any>
  getItemProperties: (modelID: number, expressID: number, recursive?: boolean) => Promise<any>
  getPropertySets: (modelID: number, expressID: number, recursive?: boolean) => Promise<any[]>
  getTypeProperties: (_modelID: number, _expressID: number, _recursive?: boolean) => Promise<any[]>
  getMaterialsProperties: (_modelID: number, _expressID: number, _recursive?: boolean) => Promise<any[]>
  createSubset: (config: {
    modelID: number
    ids: number[]
    scene?: Scene
    removePrevious?: boolean
    material?: Material | Material[]
    customID?: string
  }) => Mesh | null
  removeSubset: (modelID: number, _material?: unknown, customID?: string) => void
  removeFromSubset: (modelID: number, ids: number[], customID?: string) => void
  close: (modelID: number) => void
  dispose: () => Promise<void>
}

// Describes the public IFC facade exposed by the compatibility wrapper.
export type ViewerIfcPublicApi = {
  loader: {
    ifcManager: ViewerIfcManagerBridge
    loadAsync: (url: string) => Promise<IfcModelLike | null>
  }
  context: { items: ViewerSceneItems; fitToFrame: () => Promise<void> }
  selector: {
    pickIfcItem: (_autoFocus?: boolean) => Promise<PickResult | null>
    unpickIfcItems: () => void
  }
  setWasmPath: (path: string) => Promise<void>
  applyWebIfcConfig: (settings: any) => Promise<void>
  loadIfc: (file: File, fitToFrame?: boolean) => Promise<IfcModelLike | null>
  loadIfcUrl: (url: string, fitToFrame?: boolean) => Promise<IfcModelLike | null>
  addIfcModel: (mesh: IfcModelLike | null | undefined) => void
  removeIfcModel: (modelID: number) => void
  getSpatialStructure: (modelID: number) => Promise<any>
  getProperties: (
    modelID: number,
    expressID: number,
    recursive?: boolean,
    includeProperties?: boolean
  ) => Promise<any>
}
