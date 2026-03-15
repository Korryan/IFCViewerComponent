import CameraControls from 'camera-controls'
import * as OBC from '@thatopen/components'
import { Mesher } from '@thatopen/components-front'
import type { FragmentsModel, ItemData, MaterialDefinition, MeshData, RawMaterial, RawSample } from '@thatopen/fragments'
import fragmentsWorkerUrl from '@thatopen/fragments/worker?url'
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import {
  AmbientLight,
  Box3,
  BufferGeometry,
  Color,
  DirectionalLight,
  Float32BufferAttribute,
  HemisphereLight,
  Material,
  MeshLambertMaterial,
  Mesh,
  Matrix4,
  Object3D,
  OrthographicCamera,
  PerspectiveCamera,
  Raycaster,
  Scene,
  Vector2,
  Vector3,
  WebGLRenderer
} from 'three'
import type { Intersection } from 'three'

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

type PickResult = {
  id: number
  modelID: number
  point: Vector3
  distance: number
  object: Object3D
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
const MAX_LEGACY_ITEM_DEPTH = 32
const MATERIAL_LOOKUP_BATCH_SIZE = 1500
const MATERIAL_GEOMETRY_BATCH_SIZE = 64
const MAX_PROPERTYSET_SCAN_NODES = 6000

const ensureCameraControlsInstalled = () => {
  if (controlsInstalled) return
  CameraControls.install({ THREE })
  controlsInstalled = true
}

const resolveSpatialType = (item: any): string => {
  const candidates = [item?._category, item?.category, item?.ifcClass, item?.type]
  for (const candidate of candidates) {
    if (typeof candidate === 'string') {
      const value = candidate.trim()
      if (value) return value.toUpperCase()
    }
    if (candidate && typeof candidate === 'object' && typeof (candidate as any).value === 'string') {
      const value = (candidate as any).value.trim()
      if (value) return value.toUpperCase()
    }
  }
  return 'UNKNOWN'
}

const parseSpatialIdCandidate = (raw: unknown): number | undefined => {
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return Math.trunc(raw)
  }
  if (typeof raw === 'string' && raw.trim().length > 0) {
    const parsed = Number(raw)
    if (Number.isFinite(parsed)) {
      return Math.trunc(parsed)
    }
  }
  if (raw && typeof raw === 'object' && 'value' in (raw as Record<string, unknown>)) {
    return parseSpatialIdCandidate((raw as { value?: unknown }).value)
  }
  return undefined
}

const resolveSpatialIdCandidates = (item: any): number[] => {
  const candidates = [
    item?.expressID,
    item?.expressId,
    item?.id,
    item?.localId
  ]
  const dedup = new Set<number>()
  candidates.forEach((candidate) => {
    const parsed = parseSpatialIdCandidate(candidate)
    if (parsed !== undefined) {
      dedup.add(parsed)
    }
  })
  return Array.from(dedup)
}

const resolveSpatialSelectionId = (item: any, renderableIds?: Set<number>): number | undefined => {
  const candidates = resolveSpatialIdCandidates(item)
  if (candidates.length === 0) return undefined
  if (renderableIds && renderableIds.size > 0) {
    const matching = candidates.find((candidate) => renderableIds.has(candidate))
    if (matching !== undefined) return matching
  }
  return candidates[0]
}

const resolveSpatialName = (item: any): string | undefined => {
  const candidates = [item?.name, item?.Name]
  for (const candidate of candidates) {
    if (typeof candidate === 'string') {
      const value = candidate.trim()
      if (value) return value
    }
    if (candidate && typeof candidate === 'object' && typeof (candidate as any).value === 'string') {
      const value = (candidate as any).value.trim()
      if (value) return value
    }
  }
  return undefined
}

const toLegacySpatial = (item: any, renderableIds?: Set<number>): any => {
  const normalizedId = resolveSpatialSelectionId(item, renderableIds)
  return {
    expressID: normalizedId,
    localId: normalizedId,
    type: resolveSpatialType(item),
    name: resolveSpatialName(item),
    children: Array.isArray(item?.children)
      ? item.children.map((child: any) => toLegacySpatial(child, renderableIds))
      : []
  }
}

const toLegacyItemData = (value: any, depth = 0, stack = new WeakSet<object>()): any => {
  if (value === null || value === undefined) return value
  if (typeof value !== 'object') return value
  if (depth > MAX_LEGACY_ITEM_DEPTH) return undefined
  if (stack.has(value as object)) return undefined

  stack.add(value as object)
  try {
    if (Array.isArray(value)) {
      return value
        .map((entry) => toLegacyItemData(entry, depth + 1, stack))
        .filter((entry) => entry !== undefined)
    }

    if ('value' in value && Object.keys(value).every((key) => key === 'value' || key === 'type')) {
      return {
        value: toLegacyItemData((value as { value: unknown }).value, depth + 1, stack),
        type: typeof (value as { type?: unknown }).type === 'string' ? (value as { type?: string }).type : undefined
      }
    }

    const result: Record<string, any> = {}
    Object.entries(value).forEach(([key, entry]) => {
      if (typeof entry === 'function') return
      const normalized = toLegacyItemData(entry, depth + 1, stack)
      if (normalized !== undefined) {
        result[key] = normalized
      }
    })
    return result
  } finally {
    stack.delete(value as object)
  }
}

const readRawString = (value: unknown): string | null => {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed || null
  }
  if (!value || typeof value !== 'object') return null

  const wrapped = value as { value?: unknown }
  if (typeof wrapped.value === 'string') {
    const trimmed = wrapped.value.trim()
    return trimmed || null
  }
  return null
}

const resolveCategoryFromData = (rawData: any, normalized: any): string | null => {
  const candidates = [
    rawData?._category,
    rawData?.ifcClass,
    rawData?.category,
    rawData?.type,
    normalized?._category,
    normalized?.ifcClass,
    normalized?.category,
    normalized?.type
  ]

  for (const candidate of candidates) {
    const resolved = readRawString(candidate)
    if (resolved) {
      return resolved.toUpperCase()
    }
  }
  return null
}

const gatherPropertySets = (
  value: any,
  acc: any[],
  seen: Set<any>,
  budget: { remaining: number } = { remaining: MAX_PROPERTYSET_SCAN_NODES }
) => {
  if (budget.remaining <= 0) return
  budget.remaining -= 1
  if (!value || typeof value !== 'object' || seen.has(value)) return
  seen.add(value)

  if (
    Array.isArray((value as { HasProperties?: unknown }).HasProperties) &&
    (typeof (value as { type?: unknown }).type === 'string' ||
      typeof (value as { ifcClass?: unknown }).ifcClass === 'string' ||
      typeof (value as { category?: unknown }).category === 'string')
  ) {
    acc.push(value)
  }

  if (Array.isArray(value)) {
    value.forEach((entry) => gatherPropertySets(entry, acc, seen, budget))
    return
  }

  Object.values(value).forEach((entry) => gatherPropertySets(entry, acc, seen, budget))
}

const clamp01 = (value: number): number => {
  if (!Number.isFinite(value)) return 0
  if (value < 0) return 0
  if (value > 1) return 1
  return value
}

const normalizeColorChannel = (value: unknown): number | null => {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return null
  const normalized = numeric > 1 ? numeric / 255 : numeric
  return clamp01(normalized)
}

const normalizeColor = (value: unknown): Color | null => {
  if (Array.isArray(value) && value.length >= 3) {
    const r = normalizeColorChannel(value[0])
    const g = normalizeColorChannel(value[1])
    const b = normalizeColorChannel(value[2])
    if (r === null || g === null || b === null) return null
    return new Color().setRGB(r, g, b, THREE.SRGBColorSpace)
  }

  if (!value || typeof value !== 'object') return null

  const candidate = value as {
    r?: unknown
    g?: unknown
    b?: unknown
    x?: unknown
    y?: unknown
    z?: unknown
  }

  const r = normalizeColorChannel(candidate.r ?? candidate.x)
  const g = normalizeColorChannel(candidate.g ?? candidate.y)
  const b = normalizeColorChannel(candidate.b ?? candidate.z)
  if (r === null || g === null || b === null) return null
  return new Color().setRGB(r, g, b, THREE.SRGBColorSpace)
}

const normalizeOpacity = (value: unknown): number => {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return 1
  const normalized = numeric > 1 ? numeric / 255 : numeric
  return clamp01(normalized)
}

const materialFromDefinition = (
  definition: MaterialDefinition | undefined,
  cache: Map<string, Material>
): Material | null => {
  if (!definition) return null

  const definitionColor = (definition as any)?.color
  const color = normalizeColor(definitionColor)
  if (!color) return null
  const opacity = normalizeOpacity((definition as any)?.opacity)
  const transparent =
    typeof (definition as any)?.transparent === 'boolean' ? Boolean((definition as any)?.transparent) : opacity < 1
  const renderedFaces = Number((definition as any)?.renderedFaces)
  const side = renderedFaces === 1 ? THREE.DoubleSide : THREE.FrontSide
  const depthTest = true
  const depthWrite = !transparent

  const key = [
    color.r.toFixed(6),
    color.g.toFixed(6),
    color.b.toFixed(6),
    opacity.toFixed(6),
    transparent ? '1' : '0',
    side === THREE.DoubleSide ? '2' : '1',
    depthTest ? '1' : '0',
    depthWrite ? '1' : '0'
  ].join('|')

  const cached = cache.get(key)
  if (cached) return cached

  const material = new MeshLambertMaterial({
    color: color.clone(),
    opacity,
    transparent,
    side,
    depthTest,
    depthWrite
  })

  cache.set(key, material)
  return material
}

const materialFromRawMaterial = (raw: RawMaterial | undefined, cache: Map<string, Material>): Material | null => {
  if (!raw) return null

  const color = normalizeColor(raw)
  if (!color) return null
  const opacity = normalizeOpacity((raw as any).a)
  const transparent = opacity < 1
  const renderedFaces = Number((raw as any).renderedFaces)
  const side = renderedFaces === 1 ? THREE.DoubleSide : THREE.FrontSide
  const depthTest = true
  const depthWrite = !transparent

  const key = [
    color.r.toFixed(6),
    color.g.toFixed(6),
    color.b.toFixed(6),
    opacity.toFixed(6),
    transparent ? '1' : '0',
    side === THREE.DoubleSide ? '2' : '1',
    depthTest ? '1' : '0',
    depthWrite ? '1' : '0'
  ].join('|')

  const cached = cache.get(key)
  if (cached) return cached

  const material = new MeshLambertMaterial({
    color: color.clone(),
    opacity,
    transparent,
    side,
    depthTest,
    depthWrite
  })

  cache.set(key, material)
  return material
}

const uniqueNumbers = (values: unknown[]): number[] => {
  const dedup = new Set<number>()
  values.forEach((raw) => {
    const parsed = Number(raw)
    if (!Number.isFinite(parsed)) return
    dedup.add(Math.trunc(parsed))
  })
  return Array.from(dedup)
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
    castRayIfc: () => Intersection<Object3D> | null
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
        return this.getExpressIdFromGeometry(geometry, faceIndex)
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

    const castRayIfc = () => {
      const pickables = this.context.items.pickableIfcModels
      if (pickables.length === 0) return null
      this.raycaster.setFromCamera(this.mousePosition, this.perspectiveCamera)
      const hits = this.raycaster.intersectObjects(pickables, true)
      return hits[0] ?? null
    }

    const pickIfcItem = async (): Promise<PickResult | null> => {
      const hit = castRayIfc()
      if (!hit) return null
      const modelID = this.resolveModelID(hit.object)
      if (modelID === null || modelID < 0) return null
      const expressID = this.resolveExpressID(modelID, hit)
      if (!Number.isFinite(expressID) || expressID <= 0) return null
      return {
        id: expressID,
        modelID,
        point: hit.point.clone(),
        distance: hit.distance,
        object: hit.object
      }
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
    if (!mesh) return
    if (!this.scene.children.includes(mesh)) {
      this.scene.add(mesh)
    }
    if (!this.context.items.ifcModels.includes(mesh)) {
      this.context.items.ifcModels.push(mesh)
    }
    if (!this.context.items.pickableIfcModels.includes(mesh)) {
      this.context.items.pickableIfcModels.push(mesh)
    }
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
    const models = this.context.items.ifcModels
    if (models.length === 0) {
      this.sceneRadius = 50
      return
    }

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

    if (!hasBox) {
      this.sceneRadius = 50
      return
    }

    const size = box.getSize(new Vector3())
    this.sceneRadius = Math.max(size.x, size.y, size.z) * 0.5 + 1
  }

  private updateCameraClipPlanes() {
    const position = new Vector3()
    const target = new Vector3()
    this.cameraControls.getPosition(position)
    this.cameraControls.getTarget(target)

    const distance = Math.max(1, position.distanceTo(target))
    const radius = Math.max(5, this.sceneRadius)
    const near = Math.max(0.2, Math.min(2, distance / 120))
    const far = Math.max(150, distance + radius * 4)

    if (
      Math.abs(this.perspectiveCamera.near - near) > 1e-3 ||
      Math.abs(this.perspectiveCamera.far - far) > 1e-2
    ) {
      this.perspectiveCamera.near = near
      this.perspectiveCamera.far = far
      this.perspectiveCamera.updateProjectionMatrix()
    }

    if (
      Math.abs(this.orthographicCamera.near - near) > 1e-3 ||
      Math.abs(this.orthographicCamera.far - far) > 1e-2
    ) {
      this.orthographicCamera.near = near
      this.orthographicCamera.far = far
      this.orthographicCamera.updateProjectionMatrix()
    }
  }

  private resolveModelID(object: Object3D | null): number | null {
    let current: any = object
    while (current) {
      if (typeof current.modelID === 'number') return current.modelID
      current = current.parent
    }
    return null
  }

  private resolveExpressID(_modelID: number, hit: Intersection<Object3D>): number {
    const object: any = hit.object
    const geometry: any = object?.geometry
    const faceIndex = typeof hit.faceIndex === 'number' ? hit.faceIndex : null

    const expressAttr = geometry?.getAttribute?.('expressID')
    if (!expressAttr || typeof expressAttr.getX !== 'function') {
      return -1
    }

    const indexAttr = geometry?.index
    let vertexIndex = faceIndex !== null ? faceIndex * 3 : 0
    if (indexAttr && typeof indexAttr.getX === 'function' && faceIndex !== null) {
      vertexIndex = indexAttr.getX(faceIndex * 3)
    }

    const raw = expressAttr.getX(vertexIndex)
    return Number.isFinite(raw) ? Math.trunc(raw) : -1
  }

  private getExpressIdFromGeometry(geometry: BufferGeometry, faceIndex: number): number {
    const expressAttr: any = geometry.getAttribute('expressID')
    if (!expressAttr || typeof expressAttr.getX !== 'function') {
      return -1
    }

    const indexAttr: any = geometry.index
    let vertexIndex = faceIndex * 3
    if (indexAttr && typeof indexAttr.getX === 'function') {
      vertexIndex = indexAttr.getX(faceIndex * 3)
    }

    const resolved = expressAttr.getX(vertexIndex)
    return Number.isFinite(resolved) ? Math.trunc(resolved) : -1
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
    return path.startsWith('http://') || path.startsWith('https://') || path.startsWith('/')
  }

  private applyIfcLoaderSettings() {
    this.ifcLoader.settings.autoSetWasm = false
    this.ifcLoader.settings.wasm.path = this.wasmPath
    this.ifcLoader.settings.wasm.absolute = this.isAbsoluteWasmPath(this.wasmPath)
    this.ifcLoader.settings.webIfc = {
      ...this.ifcLoader.settings.webIfc,
      ...this.webIfcConfig
    }
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
    try {
      const parsed = new URL(url, window.location.origin)
      const tail = parsed.pathname.split('/').pop()
      return tail && tail.trim() ? tail : 'model.ifc'
    } catch {
      const tail = url.split('/').pop()
      return tail && tail.trim() ? tail : 'model.ifc'
    }
  }

  private makeModelKey(name: string): string {
    const clean = name
      .toLowerCase()
      .replace(/\.ifc$/i, '')
      .replace(/[^a-z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'model'
    const suffix = Math.random().toString(36).slice(2, 10)
    return `${clean}-${suffix}`
  }

  private cloneGeometryWithExpressId(
    source: BufferGeometry,
    expressID: number,
    worldMatrix?: Matrix4
  ): BufferGeometry | null {
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

  private buildMeshFromCache(
    record: ModelRecord,
    ids: number[],
    materialOverride?: Material | Material[]
  ): Mesh | null {
    const geometries: BufferGeometry[] = []
    const entryMaterials: Material[] = []

    const uniqueIds = uniqueNumbers(ids)
    for (const id of uniqueIds) {
      const entries = record.geometryCache.get(id)
      if (!entries || entries.length === 0) continue

      for (const entry of entries) {
        const geometry = entry.geometry.clone()
        const positions = geometry.getAttribute('position')
        if (!positions) {
          geometry.dispose()
          continue
        }

        if (!materialOverride) {
          const sourceMaterial = entry.material
          const indexCount = geometry.index ? geometry.index.count : positions.count

          if (Array.isArray(sourceMaterial)) {
            if (sourceMaterial.length === 0) {
              geometry.dispose()
              continue
            }

            const baseIndex = entryMaterials.length
            entryMaterials.push(...sourceMaterial)

            if (geometry.groups.length === 0) {
              geometry.clearGroups()
              geometry.addGroup(0, indexCount, baseIndex)
            } else {
              for (const group of geometry.groups) {
                const rawIndex = group.materialIndex
                const nextIndex = typeof rawIndex === 'number' && Number.isFinite(rawIndex) ? Math.trunc(rawIndex) : 0
                const clampedIndex = Math.max(0, Math.min(sourceMaterial.length - 1, nextIndex))
                group.materialIndex = baseIndex + clampedIndex
              }
            }
          } else {
            const baseIndex = entryMaterials.length
            entryMaterials.push(sourceMaterial)

            if (geometry.groups.length === 0) {
              geometry.clearGroups()
              geometry.addGroup(0, indexCount, baseIndex)
            } else {
              for (const group of geometry.groups) {
                group.materialIndex = baseIndex
              }
            }
          }
        } else {
          geometry.clearGroups()
        }
        geometries.push(geometry)
      }
    }

    if (geometries.length === 0) {
      return null
    }

    const merged = mergeGeometries(geometries, true)
    geometries.forEach((geometry) => geometry.dispose())
    if (!merged) {
      return null
    }

    const fallbackMaterial = new MeshLambertMaterial({ color: 0xffffff })
    const material =
      materialOverride ??
      (entryMaterials.length === 0
        ? fallbackMaterial
        : entryMaterials.length === 1
          ? entryMaterials[0]
          : entryMaterials)

    const mesh = new Mesh(merged, material)
    ;(mesh as any).modelID = record.numericId
    mesh.matrixAutoUpdate = false
    mesh.updateMatrix()
    this.tagModelObject(mesh, record.numericId)
    return mesh
  }

  private tagModelObject(root: Object3D, modelID: number) {
    root.traverse((entry: any) => {
      entry.modelID = modelID
    })
  }

  private removePickable(object: Object3D) {
    const pickables = this.context.items.pickableIfcModels
    const index = pickables.indexOf(object)
    if (index !== -1) {
      pickables.splice(index, 1)
    }
  }

  private addPickable(object: Object3D) {
    if (!this.context.items.pickableIfcModels.includes(object)) {
      this.context.items.pickableIfcModels.push(object)
    }
  }

  private removeModelFromList(model: IfcModelLike) {
    const models = this.context.items.ifcModels
    const index = models.indexOf(model)
    if (index !== -1) {
      models.splice(index, 1)
    }
  }

  private detachSubset(record: ModelRecord, subsetId: string) {
    const subset = record.subsets.get(subsetId)
    if (!subset) return

    this.removePickable(subset.mesh)
    subset.mesh.parent?.remove(subset.mesh)
    subset.mesh.geometry?.dispose?.()
    record.subsets.delete(subsetId)
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
    const existing = record.subsets.get(subsetId)

    const requestedIds = uniqueNumbers((config.ids ?? []).filter((id) => record.expressIds.has(id)))
    if (requestedIds.length === 0) {
      if (existing) this.detachSubset(record, subsetId)
      return null
    }

    const ids = new Set<number>(requestedIds)
    if (existing && config.removePrevious === false) {
      existing.ids.forEach((id) => ids.add(id))
    }

    if (existing) {
      this.detachSubset(record, subsetId)
    }

    const subsetMesh = this.buildMeshFromCache(record, Array.from(ids), config.material)
    if (!subsetMesh) return null

    const targetScene = config.scene ?? this.scene
    targetScene.add(subsetMesh)
    this.addPickable(subsetMesh)

    record.subsets.set(subsetId, {
      ids,
      mesh: subsetMesh
    })

    return subsetMesh
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
    const subset = record.subsets.get(subsetId)
    if (!subset) return

    const nextIds = new Set<number>(subset.ids)
    uniqueNumbers(ids).forEach((id) => nextIds.delete(id))

    const previousMaterial = subset.mesh.material as Material | Material[]
    const targetScene = (subset.mesh.parent as Scene | null) ?? this.scene

    this.detachSubset(record, subsetId)

    if (nextIds.size === 0) {
      return
    }

    const rebuilt = this.buildMeshFromCache(record, Array.from(nextIds), previousMaterial)
    if (!rebuilt) return

    targetScene.add(rebuilt)
    this.addPickable(rebuilt)
    record.subsets.set(subsetId, {
      ids: nextIds,
      mesh: rebuilt
    })
  }

  private async resolveMaterialsByLocalId(
    fragments: FragmentsModel,
    localIds: number[]
  ): Promise<Map<number, Material>> {
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
          const normalizedLocalId = Math.trunc(localId)
          // Keep the last material definition for a localId. In IFC, later style
          // assignments can override generic ones.
          byLocalId.set(normalizedLocalId, material)
        }
      }
    }

    return byLocalId
  }

  private async resolveGeometryMaterialsByLocalId(
    fragments: FragmentsModel,
    localIds: number[]
  ): Promise<Map<number, Array<Material | null>>> {
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

  private makeGeometryInstanceKey(
    geometry: BufferGeometry,
    matrix?: Matrix4,
    material?: Material | Material[] | null
  ): string {
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

    const geometryCache = new Map<number, GeometrySlice[]>()
    for (const [rawLocalId, meshes] of localMap as any) {
      const localId = Number(rawLocalId)
      if (!Number.isFinite(localId)) continue

      const normalizedLocalId = Math.trunc(localId)
      const resolvedMaterialForLocalId = resolvedMaterials.get(normalizedLocalId)
      const resolvedGeometryMaterialsForLocalId = geometryResolvedMaterials.get(normalizedLocalId) ?? []
      const seenGeometryInstances = new Set<string>()
      const entries: GeometrySlice[] = []

      for (const [meshIndex, source] of (meshes as Mesh[]).entries()) {
        const sourceGeometry = source.geometry as BufferGeometry | undefined
        const sourceMaterial = source.material as Material | Material[] | undefined
        // Prefer IFC-resolved materials first (per-geometry/per-item color),
        // then fallback to source material from mesher.
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

        const instanceKey = this.makeGeometryInstanceKey(sourceGeometry, sourceMatrix, resolvedMaterial)
        if (seenGeometryInstances.has(instanceKey)) {
          continue
        }
        seenGeometryInstances.add(instanceKey)

        const geometry = this.cloneGeometryWithExpressId(sourceGeometry, normalizedLocalId, sourceMatrix)
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

    const numericId = this.nextModelId++
    const record: ModelRecord = {
      numericId,
      modelKey,
      mesh: null as unknown as IfcModelLike,
      fragments,
      expressIds: new Set(expressIds),
      geometryCache,
      subsets: new Map(),
      ifcTypeCache: new Map()
    }

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

    record.mesh = baseMesh as IfcModelLike
    record.mesh.modelID = numericId
    record.mesh.__modelKey = modelKey

    return record
  }

  private async loadFromBuffer(
    buffer: ArrayBuffer,
    sourceName: string,
    fitToFrame = true
  ): Promise<IfcModelLike | null> {
    const record = await this.createModelRecord(buffer, sourceName)
    if (!record) return null

    this.modelsById.set(record.numericId, record)
    this.modelIdByKey.set(record.modelKey, record.numericId)
    this.ifcManager.state.models[record.numericId] = { mesh: record.mesh }

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
