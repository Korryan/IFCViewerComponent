import { useCallback, useEffect, useRef } from 'react'
import type { Dispatch, MutableRefObject, SetStateAction } from 'react'
import type { FurnitureItem, MetadataEntry, ObjectTree, Point3D } from './ifcViewerTypes'
import type { IfcViewerAPI } from './viewer/IfcViewerAPICompat'
import type { StoreyInfo } from './ifcRoomTree.utils'
import { MODEL_LOAD_TIMEOUT_MS, POSITION_EPSILON } from './ifcViewer.constants'
import { isSameLoadSource, type LoadSource, withTimeout } from './ifcViewer.utils'
import { removeIfcModelSafely, tuneIfcModelMaterials } from './ifcViewer.modelCleanup'
import { clearLoadedViewerModels, type Loader } from './ifcViewer.loading'
import { rebuildIfcTreeForModel } from './ifcViewer.treeHydration'
import { useIfcViewerFurnitureRestoration } from './useIfcViewerFurnitureRestoration'

type SetState<T> = Dispatch<SetStateAction<T>>

type UseIfcViewerModelLifecycleArgs = {
  viewerRef: MutableRefObject<IfcViewerAPI | null>
  ensureViewer: () => IfcViewerAPI | null
  loadTokenRef: MutableRefObject<number>
  lastModelIdRef: MutableRefObject<number | null>
  lastLoadSourceRef: MutableRefObject<LoadSource>
  roomNumbersRef: MutableRefObject<Map<number, string>>
  activeIfcTextRef: MutableRefObject<string | null>
  offsetsRestoredRef: MutableRefObject<number | null>
  furnitureRestoredRef: MutableRefObject<boolean>
  resetTree: () => void
  setIfcTree: (next: ObjectTree, modelID: number) => void
  setSelectedNodeId: (nodeId: string | null) => void
  setLastWalkRoomNodeId: (nodeId: string | null) => void
  setActiveModelId: (modelID: number | null) => void
  setStoreyInfoByNodeId: SetState<Record<string, StoreyInfo>>
  setIsFurnitureStateReconciled: (value: boolean) => void
  setStatus: (value: string | null) => void
  setError: (value: string | null) => void
  clearOffsetArtifacts: (modelID?: number | null) => void
  stopWalkMovementLoop: () => void
  resetSelection: () => void
  applyNavigationMode: (viewer: IfcViewerAPI) => void
  fitToFrameOnLoad: boolean
  file?: File | null
  defaultModelUrl?: string
  loadIfcWithCustomSettings: (
    viewer: IfcViewerAPI,
    source: { file?: File; url?: string },
    fitToFrame: boolean
  ) => Promise<any>
  activeModelId: number | null
  isHydrated: boolean
  isFurnitureStateReconciled: boolean
  tree: ObjectTree
  addCustomNode: (payload: {
    modelID: number
    expressID?: number | null
    label: string
    type?: string
    parentId?: string | null
  }) => string
  removeNode: (nodeId: string) => void
  furnitureEntries: FurnitureItem[]
  setFurnitureEntries: SetState<FurnitureItem[]>
  findCustomObjectExpressIdByItemId: (itemId: string | null | undefined) => number | null
  removeCustomCube: (expressID: number) => void
  spawnCube: (target?: Point3D | null, options?: { focus?: boolean; id?: number }) => {
    expressID: number
    position: Point3D
  } | null
  spawnStoredCustomObject: (args: {
    itemId: string
    model: string
    name?: string | null
    position: Point3D
    rotation?: Point3D | null
    geometry: NonNullable<FurnitureItem['geometry']>
    roomNumber?: string | null
    spaceIfcId?: number | null
    sourceFileName?: string | null
    focus?: boolean
  }) => { expressID: number; position: Point3D } | null
  setCustomCubeRoomNumber: (expressID: number, roomNumber?: string | null) => void
  setCustomObjectSpaceIfcId: (expressID: number, spaceIfcId?: number | null) => void
  ensureCustomCubesPickable: () => void
  findSpaceNodeIdByIfcId: (ifcId?: number | null) => string | null
  findSpaceNodeIdByRoomNumber: (roomNumber?: string | null) => string | null
  metadataEntries: MetadataEntry[]
  applyIfcElementOffset: (modelID: number, expressID: number, targetOffset: { dx: number; dy: number; dz: number }) => void
  applyIfcElementRotation: (modelID: number, expressID: number, targetRotation: Point3D) => void
  getElementWorldPosition: (modelID: number, expressID: number) => Point3D | null
  applyVisibilityFilter: (modelID: number, visibleIds: number[] | null) => void
  deletedIfcIds: Set<number>
  hideIfcElement: (modelID: number, expressID: number) => void
}

// Owns model loading, custom-object restoration, and post-load viewer state recovery.
export const useIfcViewerModelLifecycle = ({
  viewerRef,
  ensureViewer,
  loadTokenRef,
  lastModelIdRef,
  lastLoadSourceRef,
  roomNumbersRef,
  activeIfcTextRef,
  offsetsRestoredRef,
  furnitureRestoredRef,
  resetTree,
  setIfcTree,
  setSelectedNodeId,
  setLastWalkRoomNodeId,
  setActiveModelId,
  setStoreyInfoByNodeId,
  setIsFurnitureStateReconciled,
  setStatus,
  setError,
  clearOffsetArtifacts,
  stopWalkMovementLoop,
  resetSelection,
  applyNavigationMode,
  fitToFrameOnLoad,
  file,
  defaultModelUrl,
  loadIfcWithCustomSettings,
  activeModelId,
  isHydrated,
  isFurnitureStateReconciled,
  tree,
  addCustomNode,
  removeNode,
  furnitureEntries,
  setFurnitureEntries,
  findCustomObjectExpressIdByItemId,
  removeCustomCube,
  spawnCube,
  spawnStoredCustomObject,
  setCustomCubeRoomNumber,
  setCustomObjectSpaceIfcId,
  ensureCustomCubesPickable,
  findSpaceNodeIdByIfcId,
  findSpaceNodeIdByRoomNumber,
  metadataEntries,
  applyIfcElementOffset,
  applyIfcElementRotation,
  getElementWorldPosition,
  applyVisibilityFilter,
  deletedIfcIds,
  hideIfcElement
}: UseIfcViewerModelLifecycleArgs) => {
  // This rebuilds the sidebar tree through the shared hydration pipeline used for IFC model loads.
  const rebuildTreeForModel = useCallback(
    async (modelID: number, loadToken: number) => {
      const viewer = viewerRef.current
      if (!viewer) return
      await rebuildIfcTreeForModel({
        viewer,
        modelID,
        loadToken,
        activeIfcText: activeIfcTextRef.current,
        isLoadTokenCurrent: (token) => loadTokenRef.current === token,
        setIfcTree,
        resetTree,
        setSelectedNodeId,
        setStoreyInfoByNodeId,
        setRoomNumbers: (roomNumbers) => {
          roomNumbersRef.current = roomNumbers
        }
      })
    },
    [activeIfcTextRef, loadTokenRef, resetTree, roomNumbersRef, setIfcTree, setSelectedNodeId, setStoreyInfoByNodeId, viewerRef]
  )

  // This replaces the current scene with a newly loaded model and rebuilds all derived viewer state.
  const loadModel = useCallback(
    async (loader: Loader, message: string) => {
      const token = ++loadTokenRef.current

      setStatus(message)
      setError(null)
      resetSelection()
      resetTree()
      setSelectedNodeId(null)
      setLastWalkRoomNodeId(null)
      setActiveModelId(null)
      setStoreyInfoByNodeId({})
      setIsFurnitureStateReconciled(false)
      roomNumbersRef.current = new Map()
      activeIfcTextRef.current = null
      offsetsRestoredRef.current = null
      furnitureRestoredRef.current = false

      const existingViewer = viewerRef.current
      if (existingViewer) {
        stopWalkMovementLoop()
        clearOffsetArtifacts()
        clearLoadedViewerModels({
          viewer: existingViewer,
          lastModelId: lastModelIdRef.current,
          clearOffsetArtifacts
        })
      }
      lastModelIdRef.current = null
      const viewer = ensureViewer()
      if (!viewer) {
        setStatus(null)
        setError('Viewer initialization failed.')
        return
      }
      applyNavigationMode(viewer)

      try {
        const model = await withTimeout(loader(viewer), MODEL_LOAD_TIMEOUT_MS, 'IFC model loading')
        if (!model) {
          throw new Error('IFC model could not be loaded.')
        }
        tuneIfcModelMaterials(model)

        if (loadTokenRef.current !== token) {
          if (model.modelID !== undefined && viewerRef.current === viewer) {
            clearOffsetArtifacts(model.modelID)
            removeIfcModelSafely(viewer, model.modelID)
          }
          return
        }

        if (model.modelID !== undefined) {
          lastModelIdRef.current = model.modelID
          await rebuildTreeForModel(model.modelID, token)
          setActiveModelId(model.modelID)
        }
        setStatus(null)
      } catch (err) {
        if (loadTokenRef.current !== token) {
          return
        }
        console.error('Failed to load IFC model', err)
        setError('Failed to load IFC model. Check the console for details.')
        setStatus(null)
        resetTree()
      }
    },
    [
      activeIfcTextRef,
      applyNavigationMode,
      clearOffsetArtifacts,
      ensureViewer,
      furnitureRestoredRef,
      lastModelIdRef,
      loadTokenRef,
      offsetsRestoredRef,
      rebuildTreeForModel,
      resetSelection,
      resetTree,
      roomNumbersRef,
      setActiveModelId,
      setError,
      setIsFurnitureStateReconciled,
      setLastWalkRoomNodeId,
      setSelectedNodeId,
      setStatus,
      setStoreyInfoByNodeId,
      stopWalkMovementLoop,
      viewerRef
    ]
  )

  const loadModelRef = useRef(loadModel)

  // This effect keeps the imperative load callback ref in sync with the latest load function.
  useEffect(() => {
    loadModelRef.current = loadModel
  }, [loadModel])

  useIfcViewerFurnitureRestoration({
    ensureViewer,
    activeModelId,
    isHydrated,
    isFurnitureStateReconciled,
    tree,
    furnitureEntries,
    setFurnitureEntries,
    setIsFurnitureStateReconciled,
    furnitureRestoredRef,
    addCustomNode,
    removeNode,
    findCustomObjectExpressIdByItemId,
    removeCustomCube,
    spawnCube,
    spawnStoredCustomObject,
    setCustomCubeRoomNumber,
    setCustomObjectSpaceIfcId,
    ensureCustomCubesPickable,
    findSpaceNodeIdByIfcId,
    findSpaceNodeIdByRoomNumber
  })

  // This effect restores persisted IFC offsets and rotations onto the current loaded model once per model id.
  useEffect(() => {
    if (!isHydrated || activeModelId === null) return
    if (offsetsRestoredRef.current === activeModelId) return
    metadataEntries.forEach((entry) => {
      if (entry.deleted) return
      if (entry.position) {
        const current = getElementWorldPosition(activeModelId, entry.ifcId)
        if (
          !current ||
          Math.abs(current.x - entry.position.x) >= POSITION_EPSILON ||
          Math.abs(current.y - entry.position.y) >= POSITION_EPSILON ||
          Math.abs(current.z - entry.position.z) >= POSITION_EPSILON
        ) {
          applyIfcElementOffset(activeModelId, entry.ifcId, {
            dx: entry.position.x,
            dy: entry.position.y,
            dz: entry.position.z
          })
        }
      }
      const rotation = entry.rotateDelta ?? entry.rotation
      if (rotation) {
        applyIfcElementRotation(activeModelId, entry.ifcId, {
          x: rotation.x,
          y: rotation.y,
          z: rotation.z
        })
      }
    })
    offsetsRestoredRef.current = activeModelId
  }, [
    activeModelId,
    applyIfcElementOffset,
    applyIfcElementRotation,
    getElementWorldPosition,
    isHydrated,
    metadataEntries,
    offsetsRestoredRef
  ])

  // This effect reapplies soft-deleted IFC visibility after the model finishes loading.
  useEffect(() => {
    if (activeModelId === null) return
    if (deletedIfcIds.size > 0) {
      applyVisibilityFilter(activeModelId, null)
      deletedIfcIds.forEach((id) => hideIfcElement(activeModelId, id))
    }
  }, [activeModelId, applyVisibilityFilter, deletedIfcIds, hideIfcElement])

  // This effect creates the initial viewer instance and disposes it when the component unmounts.
  useEffect(() => {
    ensureViewer()

    return () => {
      clearOffsetArtifacts()
      if (viewerRef.current) {
        stopWalkMovementLoop()
        viewerRef.current.dispose()
        viewerRef.current = null
      }
      lastModelIdRef.current = null
      resetTree()
      setSelectedNodeId(null)
      setLastWalkRoomNodeId(null)
      setActiveModelId(null)
      setIsFurnitureStateReconciled(false)
      offsetsRestoredRef.current = null
      furnitureRestoredRef.current = false
      roomNumbersRef.current = new Map()
      setStoreyInfoByNodeId({})
    }
  }, [
    clearOffsetArtifacts,
    ensureViewer,
    furnitureRestoredRef,
    lastModelIdRef,
    offsetsRestoredRef,
    resetTree,
    roomNumbersRef,
    setActiveModelId,
    setIsFurnitureStateReconciled,
    setLastWalkRoomNodeId,
    setSelectedNodeId,
    setStoreyInfoByNodeId,
    stopWalkMovementLoop,
    viewerRef
  ])

  // This effect reacts to file or URL source changes and triggers the shared model load pipeline.
  useEffect(() => {
    const nextSource: LoadSource = file
      ? { kind: 'file', file }
      : defaultModelUrl
        ? { kind: 'url', url: defaultModelUrl }
        : { kind: 'none' }

    if (isSameLoadSource(lastLoadSourceRef.current, nextSource)) {
      if (nextSource.kind === 'none') {
        setStatus(null)
      }
      return
    }
    lastLoadSourceRef.current = nextSource

    if (nextSource.kind === 'file') {
      void loadModelRef.current(
        (viewer) => loadIfcWithCustomSettings(viewer, { file: nextSource.file }, fitToFrameOnLoad),
        'Loading IFC file...'
      )
      return
    }

    if (nextSource.kind === 'url') {
      void loadModelRef.current(
        (viewer) => loadIfcWithCustomSettings(viewer, { url: nextSource.url }, fitToFrameOnLoad),
        'Loading sample model...'
      )
      return
    }

    setStatus(null)
  }, [defaultModelUrl, file, fitToFrameOnLoad, lastLoadSourceRef, loadIfcWithCustomSettings, setStatus])
}
