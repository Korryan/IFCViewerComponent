import CameraControls from 'camera-controls'
import * as OBC from '@thatopen/components'
import { Mesher } from '@thatopen/components-front'
import type { FragmentsModel, ItemData } from '@thatopen/fragments'
import fragmentsWorkerUrl from '@thatopen/fragments/worker?url'
import * as THREE from 'three'
import {
  AmbientLight,
  Box3,
  BufferGeometry,
  Color,
  DirectionalLight,
  HemisphereLight,
  Material,
  Mesh,
  Object3D,
  OrthographicCamera,
  PerspectiveCamera,
  Raycaster,
  Scene,
  Vector2,
  Vector3,
  WebGLRenderer
} from 'three'
import {
  gatherPropertySets,
  resolveCategoryFromData,
  toLegacyItemData,
  toLegacySpatial
} from './IfcViewerAPICompat.legacy'
import {
  uniqueNumbers
} from './IfcViewerAPICompat.materials'
import {
  castRayIfcCandidates as castRayIfcCandidatesInternal,
  getExpressIdFromGeometry,
  type PickResult
} from './IfcViewerAPICompat.picking'
import {
  attachBaseMeshToModelRecord,
  buildGeometryCache,
  createViewerModelRecord,
  registerLoadedModelRecord,
  resolveGeometryMaterialsByLocalId as resolveGeometryMaterialsByLocalIdInternal,
  resolveMaterialsByLocalId as resolveMaterialsByLocalIdInternal
} from './IfcViewerAPICompat.models'
import {
  applyIfcLoaderSettings as applyIfcLoaderSettingsInternal,
  getNameFromUrl as getNameFromUrlInternal,
  isAbsoluteWasmPath as isAbsoluteWasmPathInternal,
  makeModelKey as makeModelKeyInternal
} from './IfcViewerAPICompat.loader'
import {
  buildMeshFromCache as buildMeshFromCacheInternal,
  createSubsetRecord,
  detachSubsetRecord,
  removeIdsFromSubsetRecord
} from './IfcViewerAPICompat.subsets'
import {
  addPickableObject,
  attachIfcModelToScene,
  computeSceneRadius,
  removeModelFromSceneList,
  removePickableObject,
  updateCameraClipPlanesForScene
} from './IfcViewerAPICompat.scene'

let controlsInstalled = false

type ViewerOptions = {
  container: HTMLElement
  backgroundColor?: Color
}

type IfcModelLike = Mesh & {
  modelID?: number
  __modelKey?: string
  removeFromParent?: () => void
}

type GeometrySlice = {
  geometry: BufferGeometry
  material: Material | Material[]
}

type SubsetRecord = {
  ids: Set<number>
  mesh: Mesh
}

type ModelRecord = {
  numericId: number
  modelKey: string
  mesh: IfcModelLike
  fragments: FragmentsModel
  expressIds: Set<number>
  geometryCache: Map<number, GeometrySlice[]>
  subsets: Map<string, SubsetRecord>
  ifcTypeCache: Map<number, string>
}

const DEFAULT_SUBSET_ID = '__default__'
const FRAGMENTS_WORKER_PATH = fragmentsWorkerUrl

const ensureCameraControlsInstalled = () => {
  if (controlsInstalled) return
  CameraControls.install({ THREE })
  controlsInstalled = true
}

export class IfcViewerAPI {
  public readonly context: {
    renderer: { postProduction: { active: boolean } }
    ifcCamera: {
      cameraControls: CameraControls
      perspectiveCamera: PerspectiveCamera
      orthographicCamera: OrthographicCamera
    }
    mouse: { position: Vector2 }
    items: { ifcModels: IfcModelLike[]; pickableIfcModels: Object3D[] }
    getScene: () => Scene
    getCamera: () => PerspectiveCamera
    castRayIfc: () => PickResult | null
    castRayIfcCandidates: (pointer?: Vector2) => PickResult[]
    fitToFrame: () => Promise<void>
  }

  public readonly IFC: {
    loader: {
      ifcManager: any
      loadAsync: (url: string) => Promise<IfcModelLike | null>
    }
    context: { items: { ifcModels: IfcModelLike[]; pickableIfcModels: Object3D[] }; fitToFrame: () => Promise<void> }
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

  public readonly axes: { setAxes: () => void }
  public readonly grid: { setGrid: () => void }

  private readonly container: HTMLElement
  private readonly scene: Scene
  private readonly renderer: WebGLRenderer
  private readonly perspectiveCamera: PerspectiveCamera
  private readonly orthographicCamera: OrthographicCamera
  private readonly cameraControls: CameraControls
  private readonly raycaster = new Raycaster()
  private readonly mousePosition = new Vector2()
  private animationFrame: number | null = null
  private lastFrameTime = performance.now()
  private disposed = false
  private resizeObserver: ResizeObserver | null = null
  private sceneRadius = 50

  private readonly components: OBC.Components
  private readonly fragmentsManager: any
  private readonly ifcLoader: any
  private readonly mesher: any
  private ifcLoaderSetupPromise: Promise<void> | null = null
  private wasmPath = '/ifc/'
  private webIfcConfig: Record<string, any> = {}

  private nextModelId = 1
  private readonly modelsById = new Map<number, ModelRecord>()
  private readonly modelIdByKey = new Map<string, number>()

  private readonly ifcManager: {
    state: { models: Record<number, { mesh: IfcModelLike }> }
    setWasmPath: (path: string) => void
    applyWebIfcConfig: (settings: any) => Promise<void>
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

  constructor(options: ViewerOptions) {
    ensureCameraControlsInstalled()

    this.container = options.container
    this.scene = new Scene()
    this.scene.background = options.backgroundColor ?? new Color(0xffffff)
    this.setupSceneLights()

    this.renderer = new WebGLRenderer({
      antialias: true,
      alpha: true
    })
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.toneMapping = THREE.NoToneMapping
    this.renderer.toneMappingExposure = 1
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    this.renderer.setSize(this.container.clientWidth || 1, this.container.clientHeight || 1)
    this.container.appendChild(this.renderer.domElement)

    this.perspectiveCamera = new PerspectiveCamera(60, 1, 0.1, 2000)
    this.perspectiveCamera.position.set(12, 8, 12)
    this.orthographicCamera = new OrthographicCamera(-10, 10, 10, -10, 0.1, 2000)
    this.orthographicCamera.position.copy(this.perspectiveCamera.position)
    this.orthographicCamera.lookAt(0, 0, 0)

    this.cameraControls = new CameraControls(this.perspectiveCamera, this.renderer.domElement)
    this.cameraControls.setTarget(0, 0, 0, false)

    this.components = new OBC.Components()
    this.fragmentsManager = this.components.get(OBC.FragmentsManager)
    this.fragmentsManager.init(FRAGMENTS_WORKER_PATH)
    this.ifcLoader = this.components.get(OBC.IfcLoader)
    this.mesher = this.components.get(Mesher as any) as any
    this.components.init()

    this.applyIfcLoaderSettings()

    this.ifcManager = {
      state: { models: {} },
      setWasmPath: (path: string) => {
        this.configureWasmPath(path)
      },
      applyWebIfcConfig: async (settings: any) => {
        await this.applyWebIfcConfig(settings)
      },
      getExpressId: (geometry: BufferGeometry, faceIndex: number) => {
        return getExpressIdFromGeometry(geometry, faceIndex)
      },
      getIfcType: (modelID: number, expressID: number) => {
        return this.modelsById.get(modelID)?.ifcTypeCache.get(expressID)
      },
      getSpatialStructure: async (modelID: number) => {
        const record = this.modelsById.get(modelID)
        if (!record) return null
        const spatial = await record.fragments.getSpatialStructure()
        return toLegacySpatial(spatial, record.expressIds)
      },
      getItemProperties: async (modelID: number, expressID: number, recursive = false) => {
        return this.getItemProperties(modelID, expressID, recursive, false)
      },
      getPropertySets: async (modelID: number, expressID: number, recursive = false) => {
        const props = await this.getItemProperties(modelID, expressID, recursive, true)
        return Array.isArray(props?.psets) ? props.psets : []
      },
      getTypeProperties: async () => [],
      getMaterialsProperties: async () => [],
      createSubset: (config) => {
        return this.createSubset(config)
      },
      removeSubset: (modelID: number, _material?: unknown, customID?: string) => {
        this.removeSubset(modelID, customID)
      },
      removeFromSubset: (modelID: number, ids: number[], customID?: string) => {
        this.removeFromSubset(modelID, ids, customID)
      },
      close: (modelID: number) => {
        this.removeIfcModel(modelID)
      },
      dispose: async () => {
        this.dispose()
      }
    }

    const castRayIfcCandidates = (pointer?: Vector2): PickResult[] => {
      return castRayIfcCandidatesInternal({
        raycaster: this.raycaster,
        pointer: pointer ?? this.mousePosition,
        camera: this.perspectiveCamera,
        pickables: this.context.items.pickableIfcModels
      })
    }

    const castRayIfc = () => {
      return castRayIfcCandidates()[0] ?? null
    }

    const pickIfcItem = async (): Promise<PickResult | null> => {
      return castRayIfcCandidates()[0] ?? null
    }

    this.context = {
      renderer: { postProduction: { active: false } },
      ifcCamera: {
        cameraControls: this.cameraControls,
        perspectiveCamera: this.perspectiveCamera,
        orthographicCamera: this.orthographicCamera
      },
      mouse: { position: this.mousePosition },
      items: {
        ifcModels: [],
        pickableIfcModels: []
      },
      getScene: () => this.scene,
      getCamera: () => this.perspectiveCamera,
      castRayIfc,
      castRayIfcCandidates,
      fitToFrame: async () => this.fitToFrame()
    }

    this.IFC = {
      loader: {
        ifcManager: this.ifcManager,
        loadAsync: async (url: string) => {
          const response = await fetch(url)
          if (!response.ok) {
            throw new Error(`Failed to load IFC from URL: ${url}`)
          }
          const buffer = await response.arrayBuffer()
          const name = this.getNameFromUrl(url)
          return this.loadFromBuffer(buffer, name, false)
        }
      },
      context: {
        items: this.context.items,
        fitToFrame: async () => this.fitToFrame()
      },
      selector: {
        pickIfcItem,
        unpickIfcItems: () => {}
      },
      setWasmPath: async (path: string) => {
        this.configureWasmPath(path)
      },
      applyWebIfcConfig: async (settings: any) => {
        await this.applyWebIfcConfig(settings)
      },
      loadIfc: async (file: File, fitToFrame = true) => {
        const buffer = await file.arrayBuffer()
        return this.loadFromBuffer(buffer, file.name, fitToFrame)
      },
      loadIfcUrl: async (url: string, fitToFrame = true) => {
        const response = await fetch(url)
        if (!response.ok) {
          throw new Error(`Failed to load IFC from URL: ${url}`)
        }
        const buffer = await response.arrayBuffer()
        return this.loadFromBuffer(buffer, this.getNameFromUrl(url), fitToFrame)
      },
      addIfcModel: (mesh: IfcModelLike | null | undefined) => {
        this.addIfcModel(mesh)
      },
      removeIfcModel: (modelID: number) => {
        this.removeIfcModel(modelID)
      },
      getSpatialStructure: async (modelID: number) => {
        const record = this.modelsById.get(modelID)
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
        return this.getItemProperties(modelID, expressID, recursive, includeProperties)
      }
    }

    this.axes = {
      setAxes: () => {
        // Axes intentionally disabled.
      }
    }

    this.grid = {
      setGrid: () => {
        // Grid intentionally disabled.
      }
    }

    this.bindPointerEvents()
    this.bindResizeObserver()
    this.startLoop()
  }

  public dispose() {
    if (this.disposed) return
    this.disposed = true

    if (this.animationFrame !== null) {
      cancelAnimationFrame(this.animationFrame)
      this.animationFrame = null
    }

    this.resizeObserver?.disconnect()
    this.resizeObserver = null
    this.container.removeEventListener('pointermove', this.handlePointerMove)
    this.container.removeEventListener('pointerdown', this.handlePointerMove)

    try {
      this.cameraControls.dispose()
    } catch {
      // no-op
    }

    const modelIds = Array.from(this.modelsById.keys())
    modelIds.forEach((modelID) => this.removeIfcModel(modelID))

    try {
      this.components.dispose()
    } catch {
      // no-op
    }

    this.renderer.dispose()
    if (this.renderer.domElement.parentElement === this.container) {
      this.container.removeChild(this.renderer.domElement)
    }
  }

  private bindPointerEvents() {
    this.container.addEventListener('pointermove', this.handlePointerMove)
    this.container.addEventListener('pointerdown', this.handlePointerMove)
  }

  private setupSceneLights() {
    const ambient = new AmbientLight(0xffffff, 0.42)
    const hemi = new HemisphereLight(0xe5f2ff, 0xd6c9b7, 0.3)
    const key = new DirectionalLight(0xffffff, 0.72)
    const fill = new DirectionalLight(0xffffff, 0.28)
    const rim = new DirectionalLight(0xffffff, 0.16)

    key.position.set(24, 32, 18)
    fill.position.set(-18, 14, -20)
    rim.position.set(4, 20, -28)

    this.scene.add(ambient)
    this.scene.add(hemi)
    this.scene.add(key)
    this.scene.add(fill)
    this.scene.add(rim)
  }

  private handlePointerMove = (event: PointerEvent) => {
    const rect = this.container.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return
    this.mousePosition.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
    this.mousePosition.y = -((event.clientY - rect.top) / rect.height) * 2 + 1
  }

  private bindResizeObserver() {
    if (typeof ResizeObserver === 'undefined') return
    this.resizeObserver = new ResizeObserver(() => this.resize())
    this.resizeObserver.observe(this.container)
    this.resize()
  }

  private resize() {
    const width = Math.max(1, this.container.clientWidth)
    const height = Math.max(1, this.container.clientHeight)
    this.renderer.setSize(width, height)
    this.perspectiveCamera.aspect = width / height
    this.perspectiveCamera.updateProjectionMatrix()

    const frustumHeight = 20
    const frustumWidth = frustumHeight * (width / height)
    this.orthographicCamera.left = -frustumWidth / 2
    this.orthographicCamera.right = frustumWidth / 2
    this.orthographicCamera.top = frustumHeight / 2
    this.orthographicCamera.bottom = -frustumHeight / 2
    this.orthographicCamera.updateProjectionMatrix()
    this.updateCameraClipPlanes()
  }

  private startLoop() {
    const animate = () => {
      if (this.disposed) return
      const now = performance.now()
      const delta = Math.max(0, (now - this.lastFrameTime) / 1000)
      this.lastFrameTime = now
      this.cameraControls.update(delta)
      this.updateCameraClipPlanes()
      this.renderer.render(this.scene, this.perspectiveCamera)
      this.animationFrame = requestAnimationFrame(animate)
    }
    this.animationFrame = requestAnimationFrame(animate)
  }

  private async fitToFrame() {
    const models = this.context.items.ifcModels
    if (models.length === 0) return

    const box = new Box3()
    let hasBox = false
    for (const model of models) {
      const modelBox = new Box3().setFromObject(model)
      if (!Number.isFinite(modelBox.min.x) || !Number.isFinite(modelBox.max.x)) continue
      if (!hasBox) {
        box.copy(modelBox)
        hasBox = true
      } else {
        box.union(modelBox)
      }
    }
    if (!hasBox) return

    const center = box.getCenter(new Vector3())
    const size = box.getSize(new Vector3())
    this.sceneRadius = Math.max(size.x, size.y, size.z) * 0.5 + 1
    const radius = Math.max(size.x, size.y, size.z) * 0.8 + 2
    const nextPos = center.clone().add(new Vector3(radius, radius * 0.6, radius))

    await this.cameraControls.setLookAt(
      nextPos.x,
      nextPos.y,
      nextPos.z,
      center.x,
      center.y,
      center.z,
      true
    )

    this.updateCameraClipPlanes()
  }

  private addIfcModel(mesh: IfcModelLike | null | undefined) {
    attachIfcModelToScene({
      scene: this.scene,
      items: this.context.items,
      mesh
    })
    this.updateSceneRadius()
    this.updateCameraClipPlanes()
  }

  private removeIfcModel(modelID: number) {
    const record = this.modelsById.get(modelID)
    if (!record) {
      delete this.ifcManager.state.models[modelID]
      return
    }

    Array.from(record.subsets.keys()).forEach((subsetId) => {
      this.detachSubset(record, subsetId)
    })

    this.removePickable(record.mesh)
    this.removeModelFromList(record.mesh)
    record.mesh.parent?.remove(record.mesh)
    record.mesh.geometry?.dispose?.()

    record.geometryCache.forEach((entries) => {
      entries.forEach((entry) => entry.geometry.dispose())
    })

    this.modelsById.delete(modelID)
    this.modelIdByKey.delete(record.modelKey)
    delete this.ifcManager.state.models[modelID]

    try {
      void this.fragmentsManager.core.disposeModel(record.modelKey)
    } catch {
      // no-op
    }

    this.updateSceneRadius()
    this.updateCameraClipPlanes()
  }

  private updateSceneRadius() {
    this.sceneRadius = computeSceneRadius(this.context.items.ifcModels)
  }

  private updateCameraClipPlanes() {
    updateCameraClipPlanesForScene({
      cameraControls: this.cameraControls,
      perspectiveCamera: this.perspectiveCamera,
      orthographicCamera: this.orthographicCamera,
      sceneRadius: this.sceneRadius
    })
  }

  private async ensureIfcLoaderReady() {
    if (this.ifcLoaderSetupPromise) {
      await this.ifcLoaderSetupPromise
      return
    }

    this.applyIfcLoaderSettings()
    this.ifcLoaderSetupPromise = this.ifcLoader.setup({
      autoSetWasm: false,
      wasm: {
        ...this.ifcLoader.settings.wasm,
        path: this.wasmPath,
        absolute: this.isAbsoluteWasmPath(this.wasmPath)
      },
      webIfc: {
        ...this.ifcLoader.settings.webIfc,
        ...this.webIfcConfig
      }
    })

    await this.ifcLoaderSetupPromise
  }

  private isAbsoluteWasmPath(path: string) {
    return isAbsoluteWasmPathInternal(path)
  }

  private applyIfcLoaderSettings() {
    applyIfcLoaderSettingsInternal({
      ifcLoader: this.ifcLoader,
      wasmPath: this.wasmPath,
      webIfcConfig: this.webIfcConfig
    })
  }

  private configureWasmPath(path: string) {
    this.wasmPath = path
    this.applyIfcLoaderSettings()
    this.ifcLoaderSetupPromise = null
  }

  private async applyWebIfcConfig(settings: any) {
    this.webIfcConfig = {
      ...this.webIfcConfig,
      ...(settings ?? {})
    }
    this.applyIfcLoaderSettings()
    this.ifcLoaderSetupPromise = null
    await this.ensureIfcLoaderReady()
  }

  private getNameFromUrl(url: string): string {
    return getNameFromUrlInternal(url)
  }

  private makeModelKey(name: string): string {
    return makeModelKeyInternal(name)
  }

  private buildMeshFromCache(
    record: ModelRecord,
    ids: number[],
    materialOverride?: Material | Material[]
  ): Mesh | null {
    return buildMeshFromCacheInternal({
      record,
      ids,
      materialOverride,
      tagModelObject: (root, modelID) => this.tagModelObject(root, modelID)
    })
  }

  private tagModelObject(root: Object3D, modelID: number) {
    root.traverse((entry: any) => {
      entry.modelID = modelID
    })
  }

  private removePickable(object: Object3D) {
    removePickableObject(this.context.items, object)
  }

  private addPickable(object: Object3D) {
    addPickableObject(this.context.items, object)
  }

  private removeModelFromList(model: IfcModelLike) {
    removeModelFromSceneList(this.context.items, model)
  }

  private detachSubset(record: ModelRecord, subsetId: string) {
    detachSubsetRecord({
      record,
      subsetId,
      removePickable: (object) => this.removePickable(object)
    })
  }

  private createSubset(config: {
    modelID: number
    ids: number[]
    scene?: Scene
    removePrevious?: boolean
    material?: Material | Material[]
    customID?: string
  }): Mesh | null {
    const record = this.modelsById.get(config.modelID)
    if (!record) return null

    const subsetId = config.customID || DEFAULT_SUBSET_ID
    return createSubsetRecord({
      record,
      subsetId,
      ids: config.ids ?? [],
      scene: config.scene ?? this.scene,
      removePrevious: config.removePrevious,
      material: config.material,
      addPickable: (object) => this.addPickable(object),
      removePickable: (object) => this.removePickable(object),
      tagModelObject: (root, modelID) => this.tagModelObject(root, modelID)
    })
  }

  private removeSubset(modelID: number, customID?: string) {
    const record = this.modelsById.get(modelID)
    if (!record) return

    const subsetId = customID || DEFAULT_SUBSET_ID
    this.detachSubset(record, subsetId)
  }

  private removeFromSubset(modelID: number, ids: number[], customID?: string) {
    const record = this.modelsById.get(modelID)
    if (!record) return

    const subsetId = customID || DEFAULT_SUBSET_ID
    removeIdsFromSubsetRecord({
      record,
      subsetId,
      ids,
      fallbackScene: this.scene,
      addPickable: (object) => this.addPickable(object),
      removePickable: (object) => this.removePickable(object),
      tagModelObject: (root, modelID) => this.tagModelObject(root, modelID)
    })
  }

  private async resolveMaterialsByLocalId(
    fragments: FragmentsModel,
    localIds: number[]
  ): Promise<Map<number, Material>> {
    return resolveMaterialsByLocalIdInternal(fragments, localIds)
  }

  private async resolveGeometryMaterialsByLocalId(
    fragments: FragmentsModel,
    localIds: number[]
  ): Promise<Map<number, Array<Material | null>>> {
    return resolveGeometryMaterialsByLocalIdInternal(fragments, localIds)
  }

  private async createModelRecord(buffer: ArrayBuffer, sourceName: string): Promise<ModelRecord | null> {
    await this.ensureIfcLoaderReady()

    const modelKey = this.makeModelKey(sourceName)
    const fragments = (await this.ifcLoader.load(new Uint8Array(buffer), true, modelKey)) as FragmentsModel
    fragments.object.visible = false

    const expressIds = uniqueNumbers(await fragments.getItemsIdsWithGeometry())
    if (expressIds.length === 0) {
      try {
        void this.fragmentsManager.core.disposeModel(modelKey)
      } catch {
        // no-op
      }
      return null
    }

    const modelIdMap: OBC.ModelIdMap = {
      [modelKey]: new Set(expressIds)
    }
    const mesherResult = await this.mesher.get(modelIdMap, {
      applyTransformation: true
    })

    const localMap = mesherResult.get(modelKey) as Map<number, Mesh[]> | undefined
    if (!localMap || localMap.size === 0) {
      try {
        void this.fragmentsManager.core.disposeModel(modelKey)
      } catch {
        // no-op
      }
      return null
    }

    const localIds = uniqueNumbers(Array.from(localMap.keys()) as number[])
    const [resolvedMaterials, geometryResolvedMaterials] = await Promise.all([
      this.resolveMaterialsByLocalId(fragments, localIds),
      this.resolveGeometryMaterialsByLocalId(fragments, localIds)
    ])

    const geometryCache = buildGeometryCache({
      localMap,
      resolvedMaterials,
      geometryResolvedMaterials
    }) as Map<number, GeometrySlice[]>

    const numericId = this.nextModelId++
    const record = createViewerModelRecord({
      numericId,
      modelKey,
      fragments,
      expressIds,
      geometryCache
    }) as ModelRecord

    const baseMesh = this.buildMeshFromCache(record, expressIds)
    if (!baseMesh) {
      geometryCache.forEach((entries) => entries.forEach((entry) => entry.geometry.dispose()))
      try {
        void this.fragmentsManager.core.disposeModel(modelKey)
      } catch {
        // no-op
      }
      return null
    }

    return attachBaseMeshToModelRecord(record, baseMesh) as ModelRecord
  }

  private async loadFromBuffer(
    buffer: ArrayBuffer,
    sourceName: string,
    fitToFrame = true
  ): Promise<IfcModelLike | null> {
    const record = await this.createModelRecord(buffer, sourceName)
    if (!record) return null

    registerLoadedModelRecord({
      record,
      modelsById: this.modelsById,
      modelIdByKey: this.modelIdByKey,
      ifcManagerState: this.ifcManager.state
    })

    this.addIfcModel(record.mesh)

    if (fitToFrame) {
      await this.fitToFrame()
    }

    return record.mesh
  }

  private async getItemProperties(
    modelID: number,
    expressID: number,
    recursive = false,
    includeProperties = false
  ): Promise<any> {
    const record = this.modelsById.get(modelID)
    if (!record) return {}

    const config = includeProperties
      ? {
          attributesDefault: true,
          relationsDefault: {
            attributes: true,
            relations: recursive
          }
        }
      : {
          attributesDefault: true,
          relationsDefault: {
            attributes: false,
            relations: false
          }
        }

    const rawData = await record.fragments
      .getItemsData([expressID], config as any)
      .then((items: ItemData[]) => (Array.isArray(items) && items.length > 0 ? items[0] : {}))
      .catch(() => ({}))

    const normalized = toLegacyItemData(rawData)
    const resolvedCategory = resolveCategoryFromData(rawData, normalized)
    if (resolvedCategory) {
      normalized.ifcClass = resolvedCategory
      normalized.type = resolvedCategory
      record.ifcTypeCache.set(expressID, resolvedCategory)
    }

    if (!includeProperties) {
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
}
