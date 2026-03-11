import CameraControls from 'camera-controls'
import * as THREE from 'three'
import {
  AmbientLight,
  AxesHelper,
  Box3,
  Color,
  DirectionalLight,
  GridHelper,
  HemisphereLight,
  OrthographicCamera,
  PerspectiveCamera,
  Raycaster,
  Scene,
  Vector2,
  Vector3,
  WebGLRenderer
} from 'three'
import type { Intersection, Mesh, Object3D } from 'three'
import { IFCLoader } from 'web-ifc-three'

let controlsInstalled = false

type ViewerOptions = {
  container: HTMLElement
  backgroundColor?: Color
}

type IfcModelLike = Mesh & {
  modelID?: number
  removeFromParent?: () => void
}

type PickResult = {
  id: number
  modelID: number
  point: Vector3
  distance: number
  object: Object3D
}

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
    castRayIfc: () => Intersection<Object3D> | null
    fitToFrame: () => Promise<void>
  }

  public readonly IFC: {
    loader: {
      ifcManager: IFCLoader['ifcManager']
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
  private readonly ifcLoader: IFCLoader
  private readonly raycaster = new Raycaster()
  private readonly mousePosition = new Vector2()
  private animationFrame: number | null = null
  private lastFrameTime = performance.now()
  private disposed = false
  private axesHelper: AxesHelper | null = null
  private gridHelper: GridHelper | null = null
  private resizeObserver: ResizeObserver | null = null

  constructor(options: ViewerOptions) {
    ensureCameraControlsInstalled()

    this.container = options.container
    this.scene = new Scene()
    this.scene.background = options.backgroundColor ?? new Color(0xffffff)
    this.setupSceneLights()

    this.renderer = new WebGLRenderer({ antialias: true, alpha: true })
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

    this.ifcLoader = new IFCLoader()

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
      if (modelID === null || modelID === undefined) return null
      if (modelID < 0) return null
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

    const loadFromBuffer = async (
      buffer: ArrayBuffer,
      fitToFrame = true
    ): Promise<IfcModelLike | null> => {
      const model = (await this.ifcLoader.parse(buffer)) as IfcModelLike | null
      if (!model) return null
      this.addIfcModel(model)
      if (fitToFrame) {
        await this.fitToFrame()
      }
      return model
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
        ifcManager: this.ifcLoader.ifcManager,
        loadAsync: async (url: string) => {
          const response = await fetch(url)
          if (!response.ok) {
            throw new Error(`Failed to load IFC from URL: ${url}`)
          }
          const buffer = await response.arrayBuffer()
          return loadFromBuffer(buffer, false)
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
        await this.ifcLoader.ifcManager.applyWebIfcConfig(settings)
      },
      loadIfc: async (file: File, fitToFrame = true) => {
        const buffer = await file.arrayBuffer()
        return loadFromBuffer(buffer, fitToFrame)
      },
      loadIfcUrl: async (url: string, fitToFrame = true) => {
        const response = await fetch(url)
        if (!response.ok) {
          throw new Error(`Failed to load IFC from URL: ${url}`)
        }
        const buffer = await response.arrayBuffer()
        return loadFromBuffer(buffer, fitToFrame)
      },
      addIfcModel: (mesh: IfcModelLike | null | undefined) => {
        this.addIfcModel(mesh)
      },
      removeIfcModel: (modelID: number) => {
        this.removeIfcModel(modelID)
      },
      getSpatialStructure: async (modelID: number) => {
        return this.ifcLoader.ifcManager.getSpatialStructure(modelID, true)
      },
      getProperties: async (
        modelID: number,
        expressID: number,
        recursive = false,
        includeProperties = false
      ) => {
        const manager = this.ifcLoader.ifcManager
        const base = (await manager.getItemProperties(modelID, expressID, recursive)) ?? {}
        if (!includeProperties) return base

        const [psets, typeProperties, materials] = await Promise.all([
          manager.getPropertySets(modelID, expressID, recursive).catch(() => []),
          manager.getTypeProperties(modelID, expressID, recursive).catch(() => []),
          manager.getMaterialsProperties(modelID, expressID, recursive).catch(() => [])
        ])
        return {
          ...base,
          psets,
          typeProperties,
          materials
        }
      }
    }

    this.axes = {
      setAxes: () => {
        if (this.axesHelper) return
        this.axesHelper = new AxesHelper(5)
        this.scene.add(this.axesHelper)
      }
    }

    this.grid = {
      setGrid: () => {
        if (this.gridHelper) return
        this.gridHelper = new GridHelper(50, 50)
        this.scene.add(this.gridHelper)
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

    this.renderer.dispose()
    this.container.removeChild(this.renderer.domElement)

    try {
      void this.ifcLoader.ifcManager.dispose()
    } catch {
      // no-op
    }
  }

  private bindPointerEvents() {
    this.container.addEventListener('pointermove', this.handlePointerMove)
    this.container.addEventListener('pointerdown', this.handlePointerMove)
  }

  private setupSceneLights() {
    // IFCLoader commonly returns Lambert-like materials, which need lighting.
    const ambient = new AmbientLight(0xffffff, 0.65)
    const hemi = new HemisphereLight(0xe5f2ff, 0xcfc7b7, 0.45)
    const key = new DirectionalLight(0xffffff, 0.9)
    const fill = new DirectionalLight(0xffffff, 0.45)

    key.position.set(24, 32, 18)
    fill.position.set(-18, 14, -20)

    this.scene.add(ambient)
    this.scene.add(hemi)
    this.scene.add(key)
    this.scene.add(fill)
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
  }

  private startLoop() {
    const animate = () => {
      if (this.disposed) return
      const now = performance.now()
      const delta = Math.max(0, (now - this.lastFrameTime) / 1000)
      this.lastFrameTime = now
      this.cameraControls.update(delta)
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
  }

  private removeIfcModel(modelID: number) {
    const manager = this.ifcLoader.ifcManager
    try {
      manager.close(modelID, this.scene)
    } catch {
      // no-op
    }

    this.context.items.ifcModels = this.context.items.ifcModels.filter(
      (entry) => entry?.modelID !== modelID
    )
    this.context.items.pickableIfcModels = this.context.items.pickableIfcModels.filter(
      (entry: any) => entry?.modelID !== modelID
    )
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
    const expressAttr = geometry?.getAttribute?.('expressID')
    if (expressAttr?.array && Number.isFinite(hit.faceIndex)) {
      const itemSize = typeof expressAttr.itemSize === 'number' ? expressAttr.itemSize : 1
      const index = Math.max(0, Math.trunc((hit.faceIndex ?? 0) * itemSize))
      const raw = expressAttr.array[index]
      if (Number.isFinite(raw)) {
        return Math.trunc(raw)
      }
    }

    if (geometry && Number.isFinite(hit.faceIndex)) {
      try {
        return this.ifcLoader.ifcManager.getExpressId(geometry, hit.faceIndex as number)
      } catch {
        // no-op
      }
    }

    return -1
  }

  private configureWasmPath(path: string) {
    // Keep manager state in sync for internals relying on manager.wasmPath.
    this.ifcLoader.ifcManager.setWasmPath(path)

    // Force absolute URL resolution, otherwise web-ifc prepends /assets/... in production.
    // That can resolve to index.html via SPA fallback and crash IFC parsing with opaque buffer errors.
    const api = (this.ifcLoader.ifcManager as any)?.ifcAPI
    if (api && typeof api.SetWasmPath === 'function') {
      api.SetWasmPath(path, true)
    }
  }
}
