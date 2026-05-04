import CameraControls from 'camera-controls'
import * as OBC from '@thatopen/components'
import { Mesher } from '@thatopen/components-front'
import * as THREE from 'three'
import {
  Color,
  Material,
  Mesh,
  OrthographicCamera,
  PerspectiveCamera,
  Raycaster,
  Scene,
  Vector2,
  WebGLRenderer
} from 'three'
import { castRayIfcCandidates as castRayIfcCandidatesInternal } from './IfcViewerAPICompat.picking'
import type { PickResult } from './IfcViewerAPICompat.picking'
import {
  applyIfcLoaderSettings as applyIfcLoaderSettingsInternal,
  isAbsoluteWasmPath as isAbsoluteWasmPathInternal
} from './IfcViewerAPICompat.loader'
import {
  createIfcManagerBridge,
  createIfcPublicApi,
  createViewerContextBridge
} from './IfcViewerAPICompat.bridge'
import { buildMeshFromCache as buildMeshFromCacheInternal } from './IfcViewerAPICompat.subsets'
import { computeSceneRadius, updateCameraClipPlanesForScene } from './IfcViewerAPICompat.scene'
import {
  attachLoadedModel, createViewerSubset, removeLoadedModel, removeViewerSubset, removeViewerSubsetIds,
  tagViewerModelObject
} from './IfcViewerAPICompat.modelLifecycle'
import { loadModelFromBuffer, loadModelFromFile, loadModelFromUrl } from './IfcViewerAPICompat.io'
import { loadLegacyItemProperties } from './IfcViewerAPICompat.properties'
import {
  bindViewerResizeObserver, disposeViewerRuntime, fitCameraToVisibleModels, renderViewerFrame,
  setupDefaultSceneLights, startViewerAnimationLoop, updateViewerPointerPosition
} from './IfcViewerAPICompat.runtime'
import type { IfcModelLike, ModelRecord, ViewerContextCompat, ViewerIfcManagerBridge, ViewerIfcPublicApi, ViewerOptions } from './IfcViewerAPICompat.types'

let controlsInstalled = false

const DEFAULT_SUBSET_ID = '__default__'
const FRAGMENTS_WORKER_PATH = '/fragments-worker.mjs'

// Installs CameraControls once for the whole viewer runtime.
const ensureCameraControlsInstalled = () => {
  if (controlsInstalled) return
  CameraControls.install({ THREE })
  controlsInstalled = true
}

// Wraps one viewer init failure with the stage name that triggered it.
const wrapViewerInitError = (stage: string, error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  const wrapped = new Error(`IFC viewer init failed at ${stage}: ${message}`)
  ;(wrapped as Error & { cause?: unknown }).cause = error
  return wrapped
}

// Runs one synchronous viewer init step and annotates any thrown error with its stage.
const runViewerInitStep = <T>(stage: string, action: () => T): T => {
  try {
    return action()
  } catch (error) {
    throw wrapViewerInitError(stage, error)
  }
}

// Runs one async viewer init step and annotates any thrown error with its stage.
const runViewerInitStepAsync = async <T>(stage: string, action: () => Promise<T>): Promise<T> => {
  try {
    return await action()
  } catch (error) {
    throw wrapViewerInitError(stage, error)
  }
}

export class IfcViewerAPI {
  public readonly context: ViewerContextCompat
  public readonly IFC: ViewerIfcPublicApi

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
  private fragmentsManager: any | null = null
  private ifcLoader: any | null = null
  private mesher: any | null = null
  private fragmentsRuntimeSetupPromise: Promise<void> | null = null
  private ifcLoaderSetupPromise: Promise<void> | null = null
  private wasmPath = '/ifc/'
  private webIfcConfig: Record<string, any> = {}

  private nextModelId = 1
  private readonly modelsById = new Map<number, ModelRecord>()
  private readonly modelIdByKey = new Map<string, number>()

  private readonly ifcManager: ViewerIfcManagerBridge

  // Constructs one compatibility viewer instance around the That Open fragments pipeline.
  constructor(options: ViewerOptions) {
    ensureCameraControlsInstalled()

    this.container = options.container
    this.scene = runViewerInitStep('scene', () => new Scene())
    this.scene.background = options.backgroundColor ?? new Color(0xffffff)
    setupDefaultSceneLights(this.scene)

    this.renderer = runViewerInitStep('renderer', () => new WebGLRenderer({
      antialias: true,
      alpha: true
    }))
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.toneMapping = THREE.NoToneMapping
    this.renderer.toneMappingExposure = 1
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    this.renderer.setSize(this.container.clientWidth || 1, this.container.clientHeight || 1)
    this.container.appendChild(this.renderer.domElement)

    this.perspectiveCamera = runViewerInitStep('perspective camera', () => new PerspectiveCamera(60, 1, 0.1, 2000))
    this.perspectiveCamera.position.set(12, 8, 12)
    this.orthographicCamera = runViewerInitStep('orthographic camera', () => new OrthographicCamera(-10, 10, 10, -10, 0.1, 2000))
    this.orthographicCamera.position.copy(this.perspectiveCamera.position)
    this.orthographicCamera.lookAt(0, 0, 0)

    this.cameraControls = runViewerInitStep('camera controls', () => new CameraControls(this.perspectiveCamera, this.renderer.domElement))
    this.cameraControls.setTarget(0, 0, 0, false)

    this.components = runViewerInitStep('components registry', () => new OBC.Components())

    this.ifcManager = createIfcManagerBridge({
      modelsById: this.modelsById,
      getCoordinationMatrix: async (modelID) => {
        const getter =
          (this.ifcLoader as any)?.ifcAPI?.GetCoordinationMatrix ??
          (this.ifcLoader as any)?.webIfc?.GetCoordinationMatrix
        const target = (this.ifcLoader as any)?.ifcAPI ?? (this.ifcLoader as any)?.webIfc ?? null
        if (typeof getter !== 'function') {
          return null
        }
        return await Promise.resolve(getter.call(target, modelID))
      },
      configureWasmPath: (path) => this.configureWasmPath(path),
      applyWebIfcConfig: async (settings) => this.applyWebIfcConfig(settings),
      getItemProperties: (modelID, expressID, recursive, includeProperties) =>
        this.getItemProperties(modelID, expressID, recursive, includeProperties),
      createSubset: (config) => this.createSubset(config),
      removeSubset: (modelID, customID) => this.removeSubset(modelID, customID),
      removeFromSubset: (modelID, ids, customID) => this.removeFromSubset(modelID, ids, customID),
      removeIfcModel: (modelID) => this.removeIfcModel(modelID),
      dispose: () => this.dispose()
    })

    const castRayIfcCandidates = (pointer?: Vector2): PickResult[] => {
      return castRayIfcCandidatesInternal({
        raycaster: this.raycaster,
        pointer: pointer ?? this.mousePosition,
        camera: this.perspectiveCamera,
        pickables: this.context.items.pickableIfcModels
      })
    }

    this.context = createViewerContextBridge({
      items: {
        ifcModels: [],
        pickableIfcModels: []
      },
      cameraControls: this.cameraControls,
      perspectiveCamera: this.perspectiveCamera,
      orthographicCamera: this.orthographicCamera,
      mousePosition: this.mousePosition,
      scene: this.scene,
      castRayIfcCandidates,
      fitToFrame: async () => this.fitToFrame()
    })

    this.IFC = createIfcPublicApi({
      ifcManager: this.ifcManager,
      items: this.context.items,
      fitToFrame: async () => this.fitToFrame(),
      configureWasmPath: (path) => this.configureWasmPath(path),
      applyWebIfcConfig: async (settings) => this.applyWebIfcConfig(settings),
      loadFromUrl: (url, fitToFrame) => this.loadFromUrl(url, fitToFrame),
      loadFromFile: (file, fitToFrame) => this.loadFromFile(file, fitToFrame),
      addIfcModel: (mesh) => this.addIfcModel(mesh),
      removeIfcModel: (modelID) => this.removeIfcModel(modelID),
      modelsById: this.modelsById,
      getItemProperties: (modelID, expressID, recursive, includeProperties) =>
        this.getItemProperties(modelID, expressID, recursive, includeProperties)
    })

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

  // Disposes the viewer runtime, loaded models, and the active WebGL context.
  public dispose() {
    if (this.disposed) return
    this.disposed = true
    disposeViewerRuntime({
      animationFrame: this.animationFrame,
      resizeObserver: this.resizeObserver,
      container: this.container,
      handlePointerMove: this.handlePointerMove,
      cameraControls: this.cameraControls,
      modelIds: Array.from(this.modelsById.keys()),
      removeIfcModel: (modelID) => this.removeIfcModel(modelID),
      components: this.components,
      renderer: this.renderer
    })
    this.animationFrame = null
    this.resizeObserver = null
  }

  // Binds pointer listeners that keep the legacy mouse position in sync with the canvas.
  private bindPointerEvents() {
    this.container.addEventListener('pointermove', this.handlePointerMove)
    this.container.addEventListener('pointerdown', this.handlePointerMove)
  }

  // Updates the cached pointer position used by raycasting and selection.
  private handlePointerMove = (event: PointerEvent) => {
    updateViewerPointerPosition({
      container: this.container,
      mousePosition: this.mousePosition,
      event
    })
  }

  // Observes container resizes and updates cameras and renderer viewport sizes.
  private bindResizeObserver() {
    this.resizeObserver = bindViewerResizeObserver({
      container: this.container,
      renderer: this.renderer,
      perspectiveCamera: this.perspectiveCamera,
      orthographicCamera: this.orthographicCamera,
      updateCameraClipPlanes: () => this.updateCameraClipPlanes()
    })
  }

  // Starts the animation loop that updates controls and renders the scene every frame.
  private startLoop() {
    this.animationFrame = startViewerAnimationLoop({
      isDisposed: () => this.disposed,
      getLastFrameTime: () => this.lastFrameTime,
      setLastFrameTime: (value) => {
        this.lastFrameTime = value
      },
      renderFrame: (now, lastFrameTime) => {
        renderViewerFrame({
          now,
          lastFrameTime,
          cameraControls: this.cameraControls,
          updateCameraClipPlanes: () => this.updateCameraClipPlanes(),
          renderer: this.renderer,
          scene: this.scene,
          perspectiveCamera: this.perspectiveCamera
        })
      }
    })
  }

  // Fits the active camera to the currently visible IFC models in the scene.
  private async fitToFrame() {
    const sceneRadius = await fitCameraToVisibleModels({
      cameraControls: this.cameraControls,
      models: this.context.items.ifcModels,
      updateCameraClipPlanes: () => this.updateCameraClipPlanes()
    })
    if (sceneRadius !== null) {
      this.sceneRadius = sceneRadius
    }
  }

  // Loads one IFC file object into the compatibility viewer.
  private async loadFromFile(file: File, fitToFrame = true): Promise<IfcModelLike | null> {
    return loadModelFromFile({
      file,
      fitToFrame,
      loadFromBuffer: (buffer, sourceName, nextFitToFrame) =>
        this.loadFromBuffer(buffer, sourceName, nextFitToFrame)
    })
  }

  // Loads one IFC URL into the compatibility viewer through an ArrayBuffer round-trip.
  private async loadFromUrl(url: string, fitToFrame = true): Promise<IfcModelLike | null> {
    return loadModelFromUrl({
      url,
      fitToFrame,
      loadFromBuffer: (buffer, sourceName, nextFitToFrame) =>
        this.loadFromBuffer(buffer, sourceName, nextFitToFrame)
    })
  }

  // Attaches one already loaded IFC mesh to the scene and refreshes camera bounds.
  private addIfcModel(mesh: IfcModelLike | null | undefined) {
    attachLoadedModel({
      scene: this.scene,
      items: this.context.items,
      mesh,
      updateSceneRadius: () => this.updateSceneRadius(),
      updateCameraClipPlanes: () => this.updateCameraClipPlanes()
    })
  }

  // Removes one loaded IFC model, its subsets, caches, and pickable scene objects.
  private removeIfcModel(modelID: number) {
    removeLoadedModel({
      modelID,
      modelsById: this.modelsById,
      modelIdByKey: this.modelIdByKey,
      ifcManagerState: this.ifcManager.state.models,
      fragmentsManager: this.fragmentsManager,
      items: this.context.items,
      updateSceneRadius: () => this.updateSceneRadius(),
      updateCameraClipPlanes: () => this.updateCameraClipPlanes()
    })
  }

  // Recomputes the scene radius from the currently visible IFC models.
  private updateSceneRadius() {
    this.sceneRadius = computeSceneRadius(this.context.items.ifcModels)
  }

  // Recomputes camera clipping planes from the current scene radius.
  private updateCameraClipPlanes() {
    updateCameraClipPlanesForScene({
      cameraControls: this.cameraControls,
      perspectiveCamera: this.perspectiveCamera,
      orthographicCamera: this.orthographicCamera,
      sceneRadius: this.sceneRadius
    })
  }

  // Lazily initializes the That Open fragments runtime so viewer mount stays lightweight and easier to debug.
  private async ensureFragmentsRuntimeReady() {
    if (this.fragmentsManager && this.ifcLoader && this.mesher) {
      return
    }

    if (this.fragmentsRuntimeSetupPromise) {
      await this.fragmentsRuntimeSetupPromise
      return
    }

    this.fragmentsRuntimeSetupPromise = (async () => {
      this.fragmentsManager = runViewerInitStep('fragments manager', () => this.components.get(OBC.FragmentsManager))
      runViewerInitStep('fragments manager init', () => {
        this.fragmentsManager?.init(FRAGMENTS_WORKER_PATH)
      })
      this.ifcLoader = runViewerInitStep('ifc loader', () => this.components.get(OBC.IfcLoader))
      this.mesher = runViewerInitStep('mesher', () => this.components.get(Mesher as any) as any)

      try {
        this.components.init()
      } catch (error) {
        console.warn('ThatOpen components init failed; continuing with manual viewer loop.', error)
      }

      this.applyIfcLoaderSettings()
    })()

    try {
      await this.fragmentsRuntimeSetupPromise
    } catch (error) {
      this.fragmentsRuntimeSetupPromise = null
      throw error
    }
  }

  // Ensures the That Open IFC loader has been configured and initialized exactly once.
  private async ensureIfcLoaderReady() {
    await this.ensureFragmentsRuntimeReady()
    if (!this.ifcLoader) {
      throw new Error('IFC loader is not available after fragments runtime initialization.')
    }

    if (this.ifcLoaderSetupPromise) {
      await this.ifcLoaderSetupPromise
      return
    }

    this.applyIfcLoaderSettings()
    this.ifcLoaderSetupPromise = runViewerInitStepAsync('ifc loader setup', async () => this.ifcLoader!.setup({
      autoSetWasm: false,
      wasm: {
        ...this.ifcLoader!.settings.wasm,
        path: this.wasmPath,
        absolute: isAbsoluteWasmPathInternal(this.wasmPath)
      },
      webIfc: {
        ...this.ifcLoader!.settings.webIfc,
        ...this.webIfcConfig
      }
    }))

    await this.ifcLoaderSetupPromise
  }

  // Applies the current wasm path and WebIFC config onto the shared IFC loader instance.
  private applyIfcLoaderSettings() {
    if (!this.ifcLoader) return

    applyIfcLoaderSettingsInternal({
      ifcLoader: this.ifcLoader,
      wasmPath: this.wasmPath,
      webIfcConfig: this.webIfcConfig
    })
  }

  // Stores one new wasm path and invalidates the current IFC loader setup promise.
  private configureWasmPath(path: string) {
    this.wasmPath = path
    this.applyIfcLoaderSettings()
    this.ifcLoaderSetupPromise = null
  }

  // Merges new WebIFC config into the loader settings and reinitializes the loader bridge.
  private async applyWebIfcConfig(settings: any) {
    this.webIfcConfig = {
      ...this.webIfcConfig,
      ...(settings ?? {})
    }
    this.applyIfcLoaderSettings()
    this.ifcLoaderSetupPromise = null
    await this.ensureIfcLoaderReady()
  }

  // Builds one subset mesh from cached fragment geometry for a given express-id list.
  private buildMeshFromCache(
    record: ModelRecord,
    ids: number[],
    materialOverride?: Material | Material[]
  ): Mesh | null {
    return buildMeshFromCacheInternal({
      record,
      ids,
      materialOverride,
      tagModelObject: tagViewerModelObject
    })
  }

  // Creates or replaces one subset mesh for a model and subset id pair.
  private createSubset(config: {
    modelID: number
    ids: number[]
    scene?: Scene
    removePrevious?: boolean
    material?: Material | Material[]
    customID?: string
  }): Mesh | null {
    return createViewerSubset({
      config: {
        ...config,
        customID: config.customID || DEFAULT_SUBSET_ID
      },
      modelsById: this.modelsById,
      fallbackScene: this.scene,
      items: this.context.items
    })
  }

  // Removes one subset mesh from a model by its custom subset id.
  private removeSubset(modelID: number, customID?: string) {
    removeViewerSubset({
      modelID,
      customID: customID || DEFAULT_SUBSET_ID,
      modelsById: this.modelsById,
      items: this.context.items
    })
  }

  // Removes a list of express ids from one existing subset mesh.
  private removeFromSubset(modelID: number, ids: number[], customID?: string) {
    removeViewerSubsetIds({
      modelID,
      ids,
      customID: customID || DEFAULT_SUBSET_ID,
      modelsById: this.modelsById,
      fallbackScene: this.scene,
      items: this.context.items
    })
  }

  // Loads one IFC buffer into fragments, registers caches, and optionally fits the camera.
  private async loadFromBuffer(
    buffer: ArrayBuffer,
    sourceName: string,
    fitToFrame = true
  ): Promise<IfcModelLike | null> {
    await this.ensureFragmentsRuntimeReady()
    if (!this.ifcLoader || !this.fragmentsManager || !this.mesher) {
      throw new Error('IFC runtime is not available after fragments initialization.')
    }

    return loadModelFromBuffer({
      buffer,
      sourceName,
      fitToFrame,
      allocateModelId: () => this.nextModelId++,
      ifcLoader: this.ifcLoader,
      fragmentsManager: this.fragmentsManager,
      mesher: this.mesher,
      ensureIfcLoaderReady: () => this.ensureIfcLoaderReady(),
      modelsById: this.modelsById,
      modelIdByKey: this.modelIdByKey,
      ifcManagerState: this.ifcManager.state,
      addIfcModel: (mesh) => this.addIfcModel(mesh),
      fitToFrameNow: () => this.fitToFrame(),
      buildMeshFromCache: (record, ids) => this.buildMeshFromCache(record, ids)
    })
  }

  // Reads one legacy property payload for an express id from the loaded fragments model.
  private async getItemProperties(
    modelID: number,
    expressID: number,
    recursive = false,
    includeProperties = false
  ): Promise<any> {
    const record = this.modelsById.get(modelID)
    if (!record) return {}
    return loadLegacyItemProperties({
      fragments: record.fragments,
      expressID,
      recursive,
      includeProperties,
      ifcTypeCache: record.ifcTypeCache
    })
  }
}
