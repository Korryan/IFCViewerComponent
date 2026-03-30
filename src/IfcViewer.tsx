import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { FrontSide, Matrix4 } from 'three'
import { IfcViewerAPI } from './viewer/IfcViewerAPICompat'
import type {
  FurnitureItem,
  HistoryEntry,
  MetadataEntry,
  ObjectTree,
  SelectedElement
} from './ifcViewerTypes'
import { useSelectionOffsets, CUSTOM_CUBE_MODEL_ID } from './hooks/useSelectionOffsets'
import { useViewerSetup } from './hooks/useViewerSetup'
import { useFurnitureState } from './hooks/useFurnitureState'
import { useInsertActions } from './hooks/useInsertActions'
import { useViewerInteractions } from './hooks/useViewerInteractions'
import { CoordsOverlay } from './components/CoordsOverlay'
import { InsertMenu } from './components/InsertMenu'
import { PropertiesPanel } from './components/PropertiesPanel'
import { ObjectTreePanel } from './components/ObjectTreePanel'
import { ShortcutsOverlay } from './components/ShortcutsOverlay'
import { SelectionMenu } from './components/SelectionMenu'
import {
  buildIfcTree,
  groupIfcTreeByRoomNumber,
  groupIfcTreeBySpatialContainment,
  useObjectTree
} from './hooks/useObjectTree'
import {
  buildRoomNumberMap,
  collectContainmentCandidateIds,
  resolveSpaceFromRelationId
} from './ifcRoomTree.utils'
import {
  CONTAINMENT_RELATION_BATCH_SIZE,
  CUBE_ITEM_PREFIX,
  ENABLE_ROOM_NUMBER_GROUPING,
  IFC_LOADER_SETTINGS,
  MAX_CONTAINMENT_RELATION_LOOKUPS,
  MAX_UNKNOWN_TREE_TYPE_LOOKUPS,
  MODEL_LOAD_TIMEOUT_MS,
  MOVE_DELTA_CUSTOM_KEY,
  POSITION_EPSILON,
  ROOM_SELECT_Y_OFFSET,
  ROTATE_DELTA_CUSTOM_KEY,
  ROTATION_EPSILON,
  SHORTCUTS,
  UNKNOWN_TREE_TYPE_BATCH_SIZE,
  wasmRootPath
} from './ifcViewer.constants'
import {
  collectContainedRelationIds,
  isSameLoadSource,
  normalizeIfcTypeValue,
  parseCubeId,
  resolveContainedSpaceId,
  resolveIfcTypeFromProperties,
  sanitizeHistoryEntries,
  sanitizeMetadataEntries,
  withTimeout,
  type LoadSource
} from './ifcViewer.utils'
import { localizeIfcType } from './utils/ifcTypeLocalization'
import './IfcViewer.css'

type IfcViewerProps = {
  file?: File | null
  defaultModelUrl?: string
  showTree?: boolean
  showProperties?: boolean
  showShortcuts?: boolean
  metadata?: MetadataEntry[]
  furniture?: FurnitureItem[]
  history?: HistoryEntry[]
  onMetadataChange?: (entries: MetadataEntry[]) => void
  onFurnitureChange?: (items: FurnitureItem[]) => void
  onHistoryChange?: (items: HistoryEntry[]) => void
  onSelectionChange?: (selection: SelectedElement | null) => void
}

type Loader = (viewer: IfcViewerAPI) => Promise<any>

type IfcLoaderManagerLike = {
  applyWebIfcConfig?: (settings: { COORDINATE_TO_ORIGIN?: boolean; USE_FAST_BOOLS?: boolean }) => Promise<void>
  ifcAPI?: {
    GetCoordinationMatrix?: (modelID: number) => Promise<number[]> | number[]
  }
  setupCoordinationMatrix?: (matrix: Matrix4) => void
}

type IfcLoadFacadeLike = {
  loadIfc?: (file: File, fitToFrame?: boolean) => Promise<any>
  loadIfcUrl?: (url: string, fitToFrame?: boolean) => Promise<any>
  addIfcModel?: (mesh: any) => void
  loader?: {
    loadAsync?: (url: string, onProgress?: (event: any) => Promise<void> | void) => Promise<any>
    ifcManager?: IfcLoaderManagerLike
  }
  context?: {
    items?: { ifcModels?: unknown[] }
    fitToFrame?: () => void
  }
}

type IfcMeshLike = {
  modelID?: number
  geometry?: { dispose?: () => void }
  material?:
    | {
        dispose?: () => void
        side?: number
        depthTest?: boolean
        depthWrite?: boolean
        transparent?: boolean
        polygonOffset?: boolean
        polygonOffsetFactor?: number
        polygonOffsetUnits?: number
        needsUpdate?: boolean
      }
    | Array<{
        dispose?: () => void
        side?: number
        depthTest?: boolean
        depthWrite?: boolean
        transparent?: boolean
        polygonOffset?: boolean
        polygonOffsetFactor?: number
        polygonOffsetUnits?: number
        needsUpdate?: boolean
      }>
}

type IfcSceneLike = {
  children?: unknown[]
  remove: (item: unknown) => void
}

type RoomListEntry = {
  nodeId: string
  label: string
  ifcId: number
  roomNumber?: string | null
  storeyId?: string | null
  storeyLabel?: string | null
}

const disposeMeshResources = (mesh: IfcMeshLike | null | undefined) => {
  if (!mesh) return
  mesh.geometry?.dispose?.()
  if (Array.isArray(mesh.material)) {
    mesh.material.forEach((material) => material?.dispose?.())
    return
  }
  mesh.material?.dispose?.()
}

const removeMeshesByModelId = (collection: unknown[] | undefined, modelID: number) => {
  if (!Array.isArray(collection)) return
  for (let index = collection.length - 1; index >= 0; index -= 1) {
    const item = collection[index] as { modelID?: number }
    if (item?.modelID === modelID) {
      collection.splice(index, 1)
    }
  }
}

const collectLoadedIfcModelIds = (viewer: IfcViewerAPI, fallbackModelID: number | null): number[] => {
  const ids = new Set<number>()
  if (typeof fallbackModelID === 'number') {
    ids.add(fallbackModelID)
  }

  const manager = viewer.IFC.loader.ifcManager as {
    state?: { models?: Record<string, { mesh?: unknown }> }
  }
  const models = manager.state?.models ?? {}
  Object.keys(models).forEach((rawId) => {
    const parsed = Number(rawId)
    if (Number.isFinite(parsed)) {
      ids.add(parsed)
    }
  })

  ;(viewer.context.items.ifcModels as Array<{ modelID?: number }>).forEach((mesh) => {
    if (typeof mesh?.modelID === 'number') {
      ids.add(mesh.modelID)
    }
  })

  return Array.from(ids)
}

const removeIfcModelSafely = (viewer: IfcViewerAPI, modelID: number) => {
  const manager = viewer.IFC.loader.ifcManager as {
    close?: (id: number, scene?: unknown) => void
    state?: { models?: Record<number, { mesh?: unknown }> }
  }
  const scene = viewer.context.getScene() as IfcSceneLike

  if (manager.state?.models?.[modelID]) {
    try {
      manager.close?.(modelID, scene)
    } catch (err) {
      console.warn('Failed to close IFC model', modelID, err)
    }
  } else {
    try {
      viewer.IFC.removeIfcModel(modelID)
    } catch (err) {
      console.warn('Failed to remove IFC model', modelID, err)
    }
  }

  const children = Array.isArray(scene.children) ? [...scene.children] : []
  children.forEach((child) => {
    const mesh = child as IfcMeshLike
    if (mesh?.modelID !== modelID) return
    scene.remove(child)
    disposeMeshResources(mesh)
  })

  removeMeshesByModelId(viewer.context.items.ifcModels as unknown[], modelID)
  removeMeshesByModelId(viewer.context.items.pickableIfcModels as unknown[], modelID)
}

const purgeIfcVisuals = (viewer: IfcViewerAPI, modelIDsToRemove: number[]) => {
  const modelIdSet = new Set(modelIDsToRemove)
  const scene = viewer.context.getScene() as IfcSceneLike
  const removed = new Set<unknown>()
  const stack = Array.isArray(scene.children) ? [...scene.children] : []

  while (stack.length > 0) {
    const current = stack.pop() as IfcMeshLike & {
      modelID?: number
      geometry?: { getAttribute?: (name: string) => unknown; dispose?: () => void }
      material?: { dispose?: () => void } | Array<{ dispose?: () => void }>
      children?: unknown[]
      parent?: { remove?: (item: unknown) => void }
    }
    if (!current) continue
    if (Array.isArray(current.children) && current.children.length > 0) {
      stack.push(...current.children)
    }

    const modelID = typeof current.modelID === 'number' ? current.modelID : null
    const isCustomCube = modelID === CUSTOM_CUBE_MODEL_ID
    const hasExpressIds = Boolean(current.geometry?.getAttribute?.('expressID'))
    const shouldRemoveByModelID = modelID !== null && modelIdSet.has(modelID) && !isCustomCube
    const shouldRemoveOrphanIfcVisual = hasExpressIds && !isCustomCube
    if (!shouldRemoveByModelID && !shouldRemoveOrphanIfcVisual) continue

    if (current.parent?.remove) {
      current.parent.remove(current)
    }
    disposeMeshResources(current)
    removed.add(current)
  }

  const purgeCollection = (collection: unknown[] | undefined) => {
    if (!Array.isArray(collection)) return
    for (let index = collection.length - 1; index >= 0; index -= 1) {
      const item = collection[index] as {
        modelID?: number
        geometry?: { getAttribute?: (name: string) => unknown }
      }
      const modelID = typeof item?.modelID === 'number' ? item.modelID : null
      const isCustomCube = modelID === CUSTOM_CUBE_MODEL_ID
      const hasExpressIds = Boolean(item?.geometry?.getAttribute?.('expressID'))
      const shouldRemoveByModelID = modelID !== null && modelIdSet.has(modelID) && !isCustomCube
      const shouldRemoveOrphanIfcVisual = hasExpressIds && !isCustomCube
      if (removed.has(item) || shouldRemoveByModelID || shouldRemoveOrphanIfcVisual) {
        collection.splice(index, 1)
      }
    }
  }

  purgeCollection(viewer.context.items.ifcModels as unknown[])
  purgeCollection(viewer.context.items.pickableIfcModels as unknown[])
}

const tuneIfcMeshMaterial = (
  material:
    | {
        side?: number
        depthTest?: boolean
        depthWrite?: boolean
        transparent?: boolean
        polygonOffset?: boolean
        polygonOffsetFactor?: number
        polygonOffsetUnits?: number
        needsUpdate?: boolean
      }
    | null
    | undefined
) => {
  if (!material) return
  // FrontSide is much more stable for IFC models that contain coplanar or duplicated faces.
  material.side = FrontSide
  material.depthTest = true
  material.depthWrite = true
  material.polygonOffset = false
  material.polygonOffsetFactor = 0
  material.polygonOffsetUnits = 0
  material.needsUpdate = true
}

const tuneIfcModelMaterials = (model: unknown) => {
  if (!model) return
  const stack: Array<
    IfcMeshLike & {
      children?: unknown[]
    }
  > = [model as IfcMeshLike & { children?: unknown[] }]
  while (stack.length > 0) {
    const current = stack.pop()
    if (!current) continue
    if (Array.isArray(current.material)) {
      current.material.forEach((material) => tuneIfcMeshMaterial(material))
    } else {
      tuneIfcMeshMaterial(current.material)
    }
    if (Array.isArray(current.children) && current.children.length > 0) {
      current.children.forEach((child) =>
        stack.push(child as IfcMeshLike & { children?: unknown[] })
      )
    }
  }
}

// Top-level viewer wiring together scene setup, selection hook, and UI overlays
const IfcViewer = ({
  file,
  defaultModelUrl,
  showTree = true,
  showProperties = true,
  showShortcuts = true,
  metadata,
  furniture,
  history,
  onMetadataChange,
  onFurnitureChange,
  onHistoryChange,
  onSelectionChange
}: IfcViewerProps) => {
  // Scene / viewer refs
  const containerRef = useRef<HTMLDivElement | null>(null)
  const viewerRef = useRef<IfcViewerAPI | null>(null)
  const uploadInputRef = useRef<HTMLInputElement | null>(null)
  // Remember the last loaded IFC model id for cleanup
  const lastModelIdRef = useRef<number | null>(null)
  const loadTokenRef = useRef(0)
  const [status, setStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const lastLoadSourceRef = useRef<LoadSource>({ kind: 'none' })
  const { tree, setIfcTree, resetTree, addCustomNode, removeNode } = useObjectTree()
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [metadataEntries, setMetadataEntries] = useState<MetadataEntry[]>([])
  const [historyEntries, setHistoryEntries] = useState<HistoryEntry[]>([])
  const [isHydrated, setIsHydrated] = useState(false)
  const furnitureRestoredRef = useRef(false)
  const offsetsRestoredRef = useRef<number | null>(null)
  const [activeModelId, setActiveModelId] = useState<number | null>(null)
  const roomNumbersRef = useRef<Map<number, string>>(new Map())
  const suppressMetadataNotifyRef = useRef(false)
  const suppressHistoryNotifyRef = useRef(false)

  const {
    selectedElement,
    offsetInputs,
    propertyFields,
    propertyError,
    isFetchingProperties,
    handleOffsetInputChange,
    applyOffsetToSelectedElement,
    handleFieldChange,
    selectById,
    selectCustomCube,
    clearIfcHighlight,
    highlightIfcGroup,
    hasRenderableExpressId,
    getIfcElementBasePosition,
    getIfcElementTranslationDelta,
    getIfcElementRotationDelta,
    getElementWorldPosition,
    moveSelectedTo,
    rotateSelectedTo,
    getSelectedWorldPosition,
    hideIfcElement,
    setCustomCubeRoomNumber,
    ensureCustomCubesPickable,
    pickCandidatesAt,
    resetSelection,
    clearOffsetArtifacts,
    spawnCube,
    removeCustomCube,
    spawnUploadedModel,
    applyIfcElementOffset,
    applyIfcElementRotation,
    applyVisibilityFilter
  } = useSelectionOffsets(viewerRef)

  const {
    furnitureEntries,
    setFurnitureEntries,
    suppressNextFurnitureNotify,
    upsertFurnitureItem,
    registerCubeFurniture,
    registerUploadedFurniture
  } = useFurnitureState({
    furniture,
    isHydrated,
    onFurnitureChange,
    setCustomCubeRoomNumber
  })

  const ensureViewer = useViewerSetup(containerRef, viewerRef, wasmRootPath)
  const metadataMap = useMemo(
    () => new Map(metadataEntries.map((entry) => [entry.ifcId, entry])),
    [metadataEntries]
  )
  const deletedIfcIds = useMemo(() => {
    const ids = new Set<number>()
    metadataEntries.forEach((entry) => {
      if (entry.deleted) {
        ids.add(entry.ifcId)
      }
    })
    return ids
  }, [metadataEntries])
  const roomOptions = useMemo<RoomListEntry[]>(() => {
    const roomNumbers = roomNumbersRef.current
    const storeyOrder: string[] = []
    const visitNode = (nodeId: string) => {
      const node = tree.nodes[nodeId]
      if (!node) return
      if (node.nodeType === 'ifc' && node.type.toUpperCase() === 'IFCBUILDINGSTOREY') {
        storeyOrder.push(nodeId)
      }
      node.children.forEach(visitNode)
    }
    tree.roots.forEach(visitNode)

    const fallbackStoreyLabel = (index: number) => (index === 0 ? 'Prizemi' : `${index}. patro`)
    const storeyLabelById = new Map<string, string>()
    storeyOrder.forEach((storeyId, index) => {
      const storey = tree.nodes[storeyId]
      if (!storey) return
      const rawName = storey.name?.trim()
      const shouldUseName =
        Boolean(rawName) &&
        rawName!.localeCompare(storey.label, undefined, { sensitivity: 'base' }) !== 0
      storeyLabelById.set(storeyId, shouldUseName ? rawName! : fallbackStoreyLabel(index))
    })

    const resolveStorey = (nodeId: string): { id: string | null; label: string | null } => {
      let currentId: string | null = nodeId
      while (currentId) {
        const node: ObjectTree['nodes'][string] | undefined = tree.nodes[currentId]
        if (!node) break
        if (node.nodeType === 'ifc' && node.type.toUpperCase() === 'IFCBUILDINGSTOREY') {
          return {
            id: node.id,
            label: storeyLabelById.get(node.id) ?? node.name?.trim() ?? node.label
          }
        }
        currentId = node.parentId
      }
      return { id: null, label: 'Nezarazene' }
    }

    return Object.values(tree.nodes)
      .filter(
        (node) => node.nodeType === 'ifc' && node.expressID !== null && node.type.toUpperCase() === 'IFCSPACE'
      )
      .map((node) => {
        const roomNumber = roomNumbers.get(node.expressID!) ?? null
        const storey = resolveStorey(node.id)
        return {
          nodeId: node.id,
          label: 'Mistnost',
          ifcId: node.expressID!,
          roomNumber,
          storeyId: storey.id,
          storeyLabel: storey.label
        }
      })
      .sort((left, right) => {
        const leftStoreyIndex =
          left.storeyId !== null && left.storeyId !== undefined
            ? storeyOrder.indexOf(left.storeyId)
            : Number.MAX_SAFE_INTEGER
        const rightStoreyIndex =
          right.storeyId !== null && right.storeyId !== undefined
            ? storeyOrder.indexOf(right.storeyId)
            : Number.MAX_SAFE_INTEGER
        if (leftStoreyIndex !== rightStoreyIndex) {
          return leftStoreyIndex - rightStoreyIndex
        }
        const leftKey = left.roomNumber?.trim() || left.label
        const rightKey = right.roomNumber?.trim() || right.label
        return leftKey.localeCompare(rightKey, undefined, { numeric: true, sensitivity: 'base' })
      })
  }, [tree.nodes, tree.roots])
  const treeNodeBySelectionKey = useMemo(() => {
    const byKey = new Map<string, string>()
    Object.values(tree.nodes).forEach((node) => {
      if (node.expressID === null) return
      const key = `${node.modelID}:${node.expressID}`
      if (!byKey.has(key)) {
        byKey.set(key, node.id)
      }
    })
    return byKey
  }, [tree.nodes])
  const resolveTreeNodeIdForSelection = useCallback(
    (modelID: number, expressID: number): string | null => {
      return treeNodeBySelectionKey.get(`${modelID}:${expressID}`) ?? null
    },
    [treeNodeBySelectionKey]
  )
  const showSidePanel = showTree || showProperties

  const loadIfcWithCustomSettings = useCallback(
    async (viewer: IfcViewerAPI, source: { file?: File; url?: string }, fitToFrame: boolean) => {
      const ifc = viewer.IFC as unknown as IfcLoadFacadeLike
      const loader = ifc.loader
      const ifcManager = loader?.ifcManager

      if (!loader?.loadAsync || !ifcManager?.applyWebIfcConfig || typeof ifc.addIfcModel !== 'function') {
        if (source.file && typeof ifc.loadIfc === 'function') {
          return ifc.loadIfc(source.file, fitToFrame)
        }
        if (source.url && typeof ifc.loadIfcUrl === 'function') {
          return ifc.loadIfcUrl(source.url, fitToFrame)
        }
        return null
      }

      await ifcManager.applyWebIfcConfig({
        // Keep geometry close to origin for stable depth precision.
        COORDINATE_TO_ORIGIN: true,
        USE_FAST_BOOLS: false
      })

      let objectUrl: string | null = null
      const resolvedUrl = source.file ? ((objectUrl = URL.createObjectURL(source.file)), objectUrl) : source.url
      if (!resolvedUrl) return null

      try {
        const model = await loader.loadAsync(resolvedUrl)
        if (!model) return null
        ifc.addIfcModel(model)

        if (fitToFrame) {
          ifc.context?.fitToFrame?.()
        }
        return model
      } finally {
        if (objectUrl) {
          URL.revokeObjectURL(objectUrl)
        }
      }
    },
    []
  )

  const pushHistoryEntry = useCallback((ifcId: number, label: string, timestamp?: string) => {
    const nextTimestamp = timestamp ?? new Date().toISOString()
    setHistoryEntries((prev) => {
      const remaining = prev.filter((entry) => entry.ifcId !== ifcId)
      const existing = prev.filter((entry) => entry.ifcId === ifcId)
      const next = [{ ifcId, label, timestamp: nextTimestamp }, ...existing].slice(0, 12)
      return [...next, ...remaining]
    })
  }, [])

  const selectedElementName = useMemo(() => {
    if (!selectedElement) return null
    const nameField = propertyFields.find(
      (field) => field.label.toLowerCase() === 'name' || field.key.toLowerCase() === 'name'
    )
    return nameField?.value || null
  }, [propertyFields, selectedElement])

  const selectedHistoryEntries = useMemo(() => {
    if (!selectedElement || selectedElement.modelID === CUSTOM_CUBE_MODEL_ID) {
      return []
    }
    const stored = metadataMap.get(selectedElement.expressID)
    const items = historyEntries.filter((entry) => entry.ifcId === selectedElement.expressID)
    if (stored?.updatedAt) {
      return [
        { ifcId: selectedElement.expressID, label: 'Saved to backend', timestamp: stored.updatedAt },
        ...items
      ]
    }
    return items
  }, [historyEntries, metadataMap, selectedElement])

  useEffect(() => {
    if (!onSelectionChange) return
    onSelectionChange(selectedElement ?? null)
  }, [onSelectionChange, selectedElement])

  const upsertMetadataEntry = useCallback(
    (ifcId: number, updater: (current: MetadataEntry) => MetadataEntry) => {
      setMetadataEntries((prev) => {
        const index = prev.findIndex((entry) => entry.ifcId === ifcId)
        const existing: MetadataEntry =
          index >= 0
            ? prev[index]
            : {
                ifcId,
                custom: {}
              }
        const nextEntry = updater(existing)
        if (index === -1) {
          return [...prev, nextEntry]
        }
        const next = prev.slice()
        next[index] = nextEntry
        return next
      })
    },
    []
  )

  const syncSelectedCubePosition = useCallback(() => {
    if (!selectedElement || selectedElement.modelID !== CUSTOM_CUBE_MODEL_ID) return
    const pos = getSelectedWorldPosition()
    if (!pos) return
    const rotation = getIfcElementRotationDelta(selectedElement.modelID, selectedElement.expressID)
    upsertFurnitureItem({
      id: `${CUBE_ITEM_PREFIX}${selectedElement.expressID}`,
      model: 'cube',
      position: { x: pos.x, y: pos.y, z: pos.z },
      rotation: rotation
        ? { x: rotation.x, y: rotation.y, z: rotation.z }
        : { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 }
    })
  }, [getIfcElementRotationDelta, getSelectedWorldPosition, selectedElement, upsertFurnitureItem])

  const syncSelectedIfcPosition = useCallback(() => {
    if (!selectedElement || selectedElement.modelID === CUSTOM_CUBE_MODEL_ID) return
    const resolved =
      getElementWorldPosition(selectedElement.modelID, selectedElement.expressID) ?? {
        x: offsetInputs.dx,
        y: offsetInputs.dy,
        z: offsetInputs.dz
      }
    const translationDelta = getIfcElementTranslationDelta(selectedElement.modelID, selectedElement.expressID)
    const rotationDelta = getIfcElementRotationDelta(selectedElement.modelID, selectedElement.expressID)
    const base = getIfcElementBasePosition(selectedElement.modelID, selectedElement.expressID) ?? resolved
    upsertMetadataEntry(selectedElement.expressID, (existing) => {
      const resolvedType =
        typeof selectedElement.type === 'string' ? selectedElement.type : existing.type
      const prev = existing.position
      const previousDelta = (() => {
        const raw = existing.custom?.[MOVE_DELTA_CUSTOM_KEY]
        if (!raw) return { dx: 0, dy: 0, dz: 0 }
        try {
          const parsed = JSON.parse(raw) as { dx?: number; dy?: number; dz?: number }
          return {
            dx: Number.isFinite(parsed.dx) ? Number(parsed.dx) : 0,
            dy: Number.isFinite(parsed.dy) ? Number(parsed.dy) : 0,
            dz: Number.isFinite(parsed.dz) ? Number(parsed.dz) : 0
          }
        } catch {
          return { dx: 0, dy: 0, dz: 0 }
        }
      })()
      const nextDelta = translationDelta
        ? {
            dx: translationDelta.x,
            dy: translationDelta.y,
            dz: translationDelta.z
          }
        : prev
          ? {
              dx: previousDelta.dx + (resolved.x - prev.x),
              dy: previousDelta.dy + (resolved.y - prev.y),
              dz: previousDelta.dz + (resolved.z - prev.z)
            }
          : {
              dx: resolved.x - base.x,
              dy: resolved.y - base.y,
              dz: resolved.z - base.z
            }
      const nextRotation = rotationDelta
        ? {
            x: rotationDelta.x,
            y: rotationDelta.y,
            z: rotationDelta.z
          }
        : {
            x: 0,
            y: 0,
            z: 0
          }
      const moveDeltaJson = JSON.stringify(nextDelta)
      const rotateDeltaJson = JSON.stringify(nextRotation)
      const isSamePosition =
        prev &&
        Math.abs(prev.x - resolved.x) < POSITION_EPSILON &&
        Math.abs(prev.y - resolved.y) < POSITION_EPSILON &&
        Math.abs(prev.z - resolved.z) < POSITION_EPSILON
      const prevRotation = existing.rotation
      const isSameRotation =
        prevRotation &&
        Math.abs(prevRotation.x - nextRotation.x) < ROTATION_EPSILON &&
        Math.abs(prevRotation.y - nextRotation.y) < ROTATION_EPSILON &&
        Math.abs(prevRotation.z - nextRotation.z) < ROTATION_EPSILON
      const currentDeltaJson = existing.custom?.[MOVE_DELTA_CUSTOM_KEY]
      const currentRotateDeltaJson = existing.custom?.[ROTATE_DELTA_CUSTOM_KEY]
      if (
        isSamePosition &&
        isSameRotation &&
        existing.type === resolvedType &&
        currentDeltaJson === moveDeltaJson &&
        currentRotateDeltaJson === rotateDeltaJson
      ) {
        return existing
      }
      return {
        ...existing,
        ifcId: selectedElement.expressID,
        type: resolvedType,
        position: resolved,
        moveDelta: {
          x: nextDelta.dx,
          y: nextDelta.dy,
          z: nextDelta.dz
        },
        rotation: nextRotation,
        rotateDelta: nextRotation,
        custom: {
          ...(existing.custom ?? {}),
          [MOVE_DELTA_CUSTOM_KEY]: moveDeltaJson,
          [ROTATE_DELTA_CUSTOM_KEY]: rotateDeltaJson
        }
      }
    })
  }, [
    getElementWorldPosition,
    getIfcElementBasePosition,
    getIfcElementRotationDelta,
    getIfcElementTranslationDelta,
    offsetInputs,
    selectedElement,
    upsertMetadataEntry
  ])

  const {
    isWalkMode,
    toggleNavigationMode,
    applyNavigationMode,
    stopWalkMovementLoop,
    hoverCoords,
    isInsertMenuOpen,
    insertMenuAnchor,
    insertTargetCoords,
    closeInsertMenu,
    isShortcutsOpen,
    setIsShortcutsOpen,
    isPickMenuOpen,
    pickMenuAnchor,
    pickMenuItems,
    closePickMenu,
    handlePickMenuSelect,
    moveCameraToPoint,
    teleportCameraToPoint
  } = useViewerInteractions({
    containerRef,
    viewerRef,
    ensureViewer,
    selectedElement,
    offsetInputs,
    showShortcuts,
    getSelectedWorldPosition,
    getIfcElementRotationDelta,
    moveSelectedTo,
    rotateSelectedTo,
    resetSelection,
    selectById,
    selectCustomCube,
    pickCandidatesAt,
    syncSelectedCubePosition,
    syncSelectedIfcPosition,
    pushHistoryEntry
  })

  const {
    treeUploadInputRef,
    findSpaceNodeIdByRoomNumber,
    resolveNodeInsertTarget,
    spawnUnitCube,
    spawnUploadedModelAt,
    handleTreeAddCube,
    handleTreeUploadModel,
    handleTreeUploadInputChange
  } = useInsertActions({
    tree,
    roomNumbersRef,
    selectedNodeId,
    setSelectedNodeId,
    hoverCoords,
    insertTargetCoords,
    addCustomNode,
    registerCubeFurniture,
    registerUploadedFurniture,
    selectById,
    selectCustomCube,
    spawnCube,
    spawnUploadedModel
  })

  const handlePropertyFieldChange = useCallback(
    (key: string, value: string) => {
      const previousValue = propertyFields.find((field) => field.key === key)?.value
      const fieldLabel = propertyFields.find((field) => field.key === key)?.label ?? key
      handleFieldChange(key, value)
      if (!selectedElement || selectedElement.modelID === CUSTOM_CUBE_MODEL_ID) {
        return
      }
      if (previousValue !== value) {
        pushHistoryEntry(selectedElement.expressID, `Field "${fieldLabel}" updated`)
      }
      upsertMetadataEntry(selectedElement.expressID, (existing) => {
        const resolvedType =
          typeof selectedElement.type === 'string' ? selectedElement.type : existing.type
        return {
          ...existing,
          ifcId: selectedElement.expressID,
          type: resolvedType,
          custom: {
            ...(existing.custom ?? {}),
            [key]: value
          }
        }
      })
    },
    [handleFieldChange, propertyFields, pushHistoryEntry, selectedElement, upsertMetadataEntry]
  )

  const applyOffsetAndPersist = useCallback(() => {
    applyOffsetToSelectedElement()
    syncSelectedCubePosition()
    syncSelectedIfcPosition()
    if (selectedElement && selectedElement.modelID !== CUSTOM_CUBE_MODEL_ID) {
      pushHistoryEntry(selectedElement.expressID, 'Position updated')
    }
  }, [
    applyOffsetToSelectedElement,
    pushHistoryEntry,
    selectedElement,
    syncSelectedCubePosition,
    syncSelectedIfcPosition
  ])

  const handleDeleteSelected = useCallback(() => {
    if (!selectedElement) return

    // Custom cubes: hard delete (remove mesh + tree node + furniture entry).
    if (selectedElement.modelID === CUSTOM_CUBE_MODEL_ID) {
      const cubeId = selectedElement.expressID
      removeCustomCube(cubeId)
      const nextFurniture = furnitureEntries.filter((item) => {
        const parsedId = parseCubeId(item.id)
        if (parsedId !== null) {
          return parsedId !== cubeId
        }
        return item.id !== `${CUBE_ITEM_PREFIX}${cubeId}`
      })
      if (onFurnitureChange) {
        suppressNextFurnitureNotify()
        onFurnitureChange(nextFurniture)
      }
      setFurnitureEntries(nextFurniture)
      const nodeId = Object.values(tree.nodes).find(
        (node) =>
          node.nodeType === 'custom' &&
          node.modelID === CUSTOM_CUBE_MODEL_ID &&
          node.expressID === cubeId
      )?.id
      if (nodeId) {
        removeNode(nodeId)
      }
      resetSelection()
      setSelectedNodeId(null)
      return
    }

    // IFC elements: soft delete (hide in viewer + mark in metadata).
    const ifcId = selectedElement.expressID
    hideIfcElement(selectedElement.modelID, ifcId)
    upsertMetadataEntry(ifcId, (existing) => ({
      ...existing,
      ifcId,
      type: typeof selectedElement.type === 'string' ? selectedElement.type : existing.type,
      deleted: true,
      custom: existing.custom ?? {}
    }))
    pushHistoryEntry(ifcId, 'Marked as deleted')
    resetSelection()
    setSelectedNodeId(null)
  }, [
    furnitureEntries,
    hideIfcElement,
    onFurnitureChange,
    pushHistoryEntry,
    removeCustomCube,
    removeNode,
    resetSelection,
    selectedElement,
    suppressNextFurnitureNotify,
    tree.nodes,
    upsertMetadataEntry
  ])

  useEffect(() => {
    const hasExternalState =
      metadata !== undefined || furniture !== undefined || history !== undefined
    const hasExternalHandlers = Boolean(onMetadataChange || onFurnitureChange || onHistoryChange)
    if (!hasExternalState) {
      if (!hasExternalHandlers) {
        setIsHydrated(true)
      }
      return
    }

    if (metadata !== undefined) {
      suppressMetadataNotifyRef.current = true
      setMetadataEntries(sanitizeMetadataEntries(Array.isArray(metadata) ? metadata : []))
    }
    if (history !== undefined) {
      suppressHistoryNotifyRef.current = true
      setHistoryEntries(sanitizeHistoryEntries(Array.isArray(history) ? history : []))
    }
    setIsHydrated(true)
  }, [furniture, history, metadata, onFurnitureChange, onHistoryChange, onMetadataChange])

  useEffect(() => {
    if (!isHydrated || !onMetadataChange) return
    if (suppressMetadataNotifyRef.current) {
      suppressMetadataNotifyRef.current = false
      return
    }
    onMetadataChange(metadataEntries)
  }, [isHydrated, metadataEntries, onMetadataChange])

  useEffect(() => {
    if (!isHydrated || !onHistoryChange) return
    if (suppressHistoryNotifyRef.current) {
      suppressHistoryNotifyRef.current = false
      return
    }
    const timer = window.setTimeout(() => {
      onHistoryChange(historyEntries)
    }, 500)
    return () => window.clearTimeout(timer)
  }, [historyEntries, isHydrated, onHistoryChange])

  useEffect(() => {
    if (!selectedElement || propertyFields.length === 0) return
    const stored = metadataMap.get(selectedElement.expressID)
    if (!stored?.custom) return
    propertyFields.forEach((field) => {
      const customValue = stored.custom?.[field.key]
      if (typeof customValue === 'string' && customValue !== field.value) {
        handleFieldChange(field.key, customValue)
      }
    })
  }, [handleFieldChange, metadataMap, propertyFields, selectedElement])

  useEffect(() => {
    if (!isHydrated || furnitureRestoredRef.current) return
    const viewer = ensureViewer()
    if (!viewer) return
    furnitureEntries.forEach((item) => {
      if (item.model !== 'cube') return
      const cubeId = parseCubeId(item.id)
      if (!cubeId) return
      const info = spawnCube(item.position, { id: cubeId, focus: false })
      if (!info) return
      setCustomCubeRoomNumber(info.expressID, item.roomNumber)
      const parentId = findSpaceNodeIdByRoomNumber(item.roomNumber)
      addCustomNode({
        modelID: CUSTOM_CUBE_MODEL_ID,
        expressID: info.expressID,
        label: `Cube #${info.expressID}`,
        type: 'CUBE',
        parentId
      })
    })
    furnitureRestoredRef.current = true
  }, [
    addCustomNode,
    ensureViewer,
    findSpaceNodeIdByRoomNumber,
    furnitureEntries,
    isHydrated,
    setCustomCubeRoomNumber,
    spawnCube
  ])

  useEffect(() => {
    if (activeModelId === null) return
    ensureCustomCubesPickable()
  }, [activeModelId, ensureCustomCubesPickable])

  useEffect(() => {
    if (!isHydrated || tree.roots.length === 0) return
    const existing = new Set<number>()
    Object.values(tree.nodes).forEach((node) => {
      if (node.nodeType === 'custom' && node.modelID === CUSTOM_CUBE_MODEL_ID && node.expressID !== null) {
        existing.add(node.expressID)
      }
    })
    furnitureEntries.forEach((item) => {
      if (item.model !== 'cube') return
      const cubeId = parseCubeId(item.id)
      if (!cubeId || existing.has(cubeId)) return
      const parentId = findSpaceNodeIdByRoomNumber(item.roomNumber)
      addCustomNode({
        modelID: CUSTOM_CUBE_MODEL_ID,
        expressID: cubeId,
        label: `Cube #${cubeId}`,
        type: 'CUBE',
        parentId
      })
    })
  }, [addCustomNode, findSpaceNodeIdByRoomNumber, furnitureEntries, isHydrated, tree.nodes, tree.roots])

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
    metadataEntries
  ])

  useEffect(() => {
    if (activeModelId === null) {
      return
    }
    // Keep original IFC mesh visible by default; building base subsets for full model
    // on every load can introduce extra coplanar geometry and visible z-fighting.
    if (deletedIfcIds.size > 0) {
      applyVisibilityFilter(activeModelId, null)
      deletedIfcIds.forEach((id) => hideIfcElement(activeModelId, id))
    }
  }, [activeModelId, applyVisibilityFilter, deletedIfcIds, hideIfcElement])

  const resolveIfcNodeType = useCallback(
    async (viewer: IfcViewerAPI, modelID: number, expressID: number): Promise<string | null> => {
      try {
        const manager = viewer.IFC?.loader?.ifcManager as
          | { getIfcType?: (modelID: number, id: number) => string | undefined }
          | undefined
        const directType = manager?.getIfcType?.(modelID, expressID)
        const normalizedDirect = normalizeIfcTypeValue(directType)
        if (normalizedDirect) {
          return normalizedDirect
        }
      } catch {
        // Fallback to property read below.
      }

      try {
        const props = await viewer.IFC.getProperties(modelID, expressID, false, false)
        return resolveIfcTypeFromProperties(props)
      } catch {
        return null
      }
    },
    []
  )

  const hydrateUnknownIfcNodeTypes = useCallback(
    async (
      viewer: IfcViewerAPI,
      tree: ObjectTree,
      modelID: number,
      loadToken: number
    ): Promise<ObjectTree> => {
      const unknownNodes = Object.values(tree.nodes).filter(
        (node) =>
          node.nodeType === 'ifc' &&
          node.expressID !== null &&
          node.type.toUpperCase() === 'UNKNOWN'
      )
      if (unknownNodes.length === 0) return tree

      const lookupNodes =
        unknownNodes.length > MAX_UNKNOWN_TREE_TYPE_LOOKUPS
          ? unknownNodes.slice(0, MAX_UNKNOWN_TREE_TYPE_LOOKUPS)
          : unknownNodes

      if (lookupNodes.length < unknownNodes.length) {
        console.warn(
          `Type lookup limited to ${MAX_UNKNOWN_TREE_TYPE_LOOKUPS} of ${unknownNodes.length} IFC nodes.`
        )
      }

      const updates = new Map<string, string>()
      for (let i = 0; i < lookupNodes.length; i += UNKNOWN_TREE_TYPE_BATCH_SIZE) {
        if (loadTokenRef.current !== loadToken) {
          return tree
        }
        const batch = lookupNodes.slice(i, i + UNKNOWN_TREE_TYPE_BATCH_SIZE)
        const resolved = await Promise.all(
          batch.map(async (node) => {
            const expressID = node.expressID
            if (expressID === null) return null
            const resolvedType = await resolveIfcNodeType(viewer, modelID, expressID)
            if (!resolvedType || resolvedType === 'UNKNOWN') return null
            return { nodeId: node.id, type: resolvedType }
          })
        )
        resolved.forEach((entry) => {
          if (!entry) return
          updates.set(entry.nodeId, entry.type)
        })
      }

      if (updates.size === 0) return tree

      const nextNodes: ObjectTree['nodes'] = { ...tree.nodes }
      updates.forEach((resolvedType, nodeId) => {
        const node = nextNodes[nodeId]
        if (!node) return
        nextNodes[nodeId] = {
          ...node,
          type: resolvedType,
          label: localizeIfcType(resolvedType)
        }
      })
      return {
        nodes: nextNodes,
        roots: tree.roots
      }
    },
    [resolveIfcNodeType]
  )

  const buildSpatialContainmentMap = useCallback(
    async (
      viewer: IfcViewerAPI,
      tree: ObjectTree,
      modelID: number,
      loadToken: number
    ): Promise<Map<number, number>> => {
      const spaceIds = new Set<number>()
      Object.values(tree.nodes).forEach((node) => {
        if (node.nodeType !== 'ifc' || node.expressID === null) return
        if (node.type.toUpperCase() === 'IFCSPACE') {
          spaceIds.add(node.expressID)
        }
      })
      if (spaceIds.size === 0) return new Map()

      const candidates = collectContainmentCandidateIds(tree)
      if (candidates.length === 0) return new Map()
      const lookupIds =
        candidates.length > MAX_CONTAINMENT_RELATION_LOOKUPS
          ? candidates.slice(0, MAX_CONTAINMENT_RELATION_LOOKUPS)
          : candidates

      if (lookupIds.length < candidates.length) {
        console.warn(
          `Containment lookup limited to ${MAX_CONTAINMENT_RELATION_LOOKUPS} of ${candidates.length} IFC nodes.`
        )
      }

      const map = new Map<number, number>()
      const relationSpaceCache = new Map<number, number | null>()
      for (let i = 0; i < lookupIds.length; i += CONTAINMENT_RELATION_BATCH_SIZE) {
        if (loadTokenRef.current !== loadToken) {
          return map
        }
        const batch = lookupIds.slice(i, i + CONTAINMENT_RELATION_BATCH_SIZE)
        const entries = await Promise.all(
          batch.map(async (expressID) => {
            try {
              const properties = await viewer.IFC.getProperties(modelID, expressID, false, true)
              let spaceId = resolveContainedSpaceId(properties)

              if (spaceId === null) {
                const relationIds = collectContainedRelationIds(properties)
                for (const relationId of relationIds) {
                  let cachedSpace = relationSpaceCache.get(relationId)
                  if (cachedSpace === undefined) {
                    cachedSpace = await resolveSpaceFromRelationId(viewer, modelID, relationId)
                    relationSpaceCache.set(relationId, cachedSpace)
                  }
                  if (cachedSpace !== null && spaceIds.has(cachedSpace)) {
                    spaceId = cachedSpace
                    break
                  }
                }
              }

              if (spaceId === null || !spaceIds.has(spaceId)) return null
              return [expressID, spaceId] as const
            } catch (err) {
              console.warn('Failed to resolve IfcRelContainedInSpatialStructure for', expressID, err)
              return null
            }
          })
        )
        entries.forEach((entry) => {
          if (!entry) return
          map.set(entry[0], entry[1])
        })
      }

      return map
    },
    []
  )

  const rebuildTreeForModel = useCallback(
    async (modelID: number, loadToken: number) => {
      const viewer = viewerRef.current
      if (!viewer) return
      try {
        const spatial = await viewer.IFC.getSpatialStructure(modelID)
        if (loadTokenRef.current !== loadToken) return
        try {
          const rawTree = buildIfcTree(spatial, modelID)
          if (loadTokenRef.current !== loadToken) return
          roomNumbersRef.current = new Map()
          setIfcTree(rawTree, modelID)
          setSelectedNodeId(rawTree.roots[0] ?? null)

          // Enrich labels/relations in background so loading is never blocked by heavy IFC relation traversal.
          void (async () => {
            let nextTree = rawTree

            try {
              const hydratedTree = await hydrateUnknownIfcNodeTypes(viewer, nextTree, modelID, loadToken)
              if (loadTokenRef.current !== loadToken) return
              if (hydratedTree !== nextTree) {
                nextTree = hydratedTree
                setIfcTree(nextTree, modelID)
              }
            } catch (err) {
              console.warn('Failed to hydrate UNKNOWN IFC node labels', err)
            }

            try {
              const containmentMap = await buildSpatialContainmentMap(viewer, nextTree, modelID, loadToken)
              if (loadTokenRef.current !== loadToken) return
              const containedTree = groupIfcTreeBySpatialContainment(nextTree, containmentMap)
              if (containedTree !== nextTree) {
                nextTree = containedTree
                setIfcTree(nextTree, modelID)
              }
            } catch (err) {
              console.warn('Failed to group tree nodes by IfcRelContainedInSpatialStructure', err)
            }

            // Optional grouping: if room numbers exist in Psets, move elements under the matching IfcSpace.
            if (ENABLE_ROOM_NUMBER_GROUPING) {
              try {
                const roomNumbers = await buildRoomNumberMap(viewer, nextTree, modelID)
                if (loadTokenRef.current !== loadToken) return
                roomNumbersRef.current = roomNumbers
                const roomGroupedTree = groupIfcTreeByRoomNumber(nextTree, roomNumbers)
                if (roomGroupedTree !== nextTree) {
                  setIfcTree(roomGroupedTree, modelID)
                }
              } catch (err) {
                console.warn('Failed to group storey nodes by room number', err)
              }
            }
          })()
        } catch (err) {
          console.error('Failed to build IFC tree', err)
          resetTree()
          setSelectedNodeId(null)
        }
      } catch (err) {
        if (loadTokenRef.current !== loadToken) return
        console.error('Failed to build IFC tree', err)
        resetTree()
        setSelectedNodeId(null)
      }
    },
    [buildSpatialContainmentMap, hydrateUnknownIfcNodeTypes, resetTree, setIfcTree]
  )

  const collectIfcIdsInSubtree = useCallback(
    (rootNodeId: string): { modelID: number | null; ids: number[] } => {
      const root = tree.nodes[rootNodeId]
      if (!root) return { modelID: null, ids: [] }

      let modelID: number | null = root.nodeType === 'ifc' ? root.modelID : null
      const ids = new Set<number>()
      const stack = [rootNodeId]

      while (stack.length > 0) {
        const nodeId = stack.pop()
        if (!nodeId) continue
        const node = tree.nodes[nodeId]
        if (!node) continue

        if (node.nodeType === 'ifc' && node.expressID !== null) {
          if (modelID === null) {
            modelID = node.modelID
          }
          if (node.modelID === modelID) {
            ids.add(node.expressID)
          }
        }

        if (node.children.length > 0) {
          stack.push(...node.children)
        }
      }

      return { modelID, ids: Array.from(ids) }
    },
    [tree.nodes]
  )

  const handleTreeSelect = useCallback(
    async (nodeId: string) => {
      setSelectedNodeId(nodeId)
      const node = tree.nodes[nodeId]
      if (!node) return

      if (
        node.nodeType === 'custom' &&
        node.modelID === CUSTOM_CUBE_MODEL_ID &&
        node.expressID !== null
      ) {
        clearIfcHighlight()
        selectCustomCube(node.expressID)
        return
      }

      if (node.nodeType === 'ifc' && node.expressID !== null) {
        await selectById(node.modelID, node.expressID, { autoFocus: false })
        const subtree = collectIfcIdsInSubtree(nodeId)
        if (subtree.modelID === node.modelID) {
          const renderableIds = subtree.ids.filter((id) => hasRenderableExpressId(node.modelID, id))
          const isNodeRenderable = hasRenderableExpressId(node.modelID, node.expressID)
          if (renderableIds.length > 0 && (renderableIds.length > 1 || !isNodeRenderable)) {
            highlightIfcGroup(node.modelID, renderableIds, {
              anchorExpressID: node.expressID
            })
          }
        }
        return
      }

      clearIfcHighlight()
      resetSelection()
    },
    [
      clearIfcHighlight,
      collectIfcIdsInSubtree,
      hasRenderableExpressId,
      highlightIfcGroup,
      resetSelection,
      selectById,
      selectCustomCube,
      tree.nodes
    ]
  )

  const handleRoomSelect = useCallback(
    async (nodeId: string) => {
      if (isWalkMode) {
        setSelectedNodeId(null)
      } else {
        setSelectedNodeId(nodeId)
      }
      const target = await resolveNodeInsertTarget(nodeId, { autoFocus: true })
      const roomFocusPoint = target
        ? { x: target.x, y: target.y + ROOM_SELECT_Y_OFFSET, z: target.z }
        : null
      if (!moveCameraToPoint(roomFocusPoint)) {
        teleportCameraToPoint(roomFocusPoint)
      }
      if (isWalkMode) {
        clearIfcHighlight()
        resetSelection()
        setSelectedNodeId(null)
      }
    },
    [
      clearIfcHighlight,
      isWalkMode,
      moveCameraToPoint,
      resetSelection,
      resolveNodeInsertTarget,
      teleportCameraToPoint
    ]
  )
  useEffect(() => {
    if (!selectedElement) {
      setSelectedNodeId(null)
      return
    }

    const matchId = resolveTreeNodeIdForSelection(selectedElement.modelID, selectedElement.expressID)
    setSelectedNodeId(matchId)
  }, [resolveTreeNodeIdForSelection, selectedElement])

  const loadModel = useCallback(
    async (loader: Loader, message: string) => {
      const token = ++loadTokenRef.current

      setStatus(message)
      setError(null)
      resetSelection()
      resetTree()
      setSelectedNodeId(null)
      setActiveModelId(null)
      roomNumbersRef.current = new Map()
      offsetsRestoredRef.current = null

      // Hard reset viewer instance so the next load always starts from an empty scene.
      const previousViewer = viewerRef.current
      if (previousViewer) {
        stopWalkMovementLoop()
        const loadedModelIds = collectLoadedIfcModelIds(previousViewer, lastModelIdRef.current)
        loadedModelIds.forEach((modelID) => {
          clearOffsetArtifacts(modelID)
          removeIfcModelSafely(previousViewer, modelID)
        })
        purgeIfcVisuals(previousViewer, loadedModelIds)
        previousViewer.dispose()
        viewerRef.current = null
      }
      containerRef.current?.replaceChildren()
      lastModelIdRef.current = null
      const viewer = ensureViewer()
      if (!viewer) {
        setStatus(null)
        setError('Viewer initialization failed.')
        return
      }
      applyNavigationMode(viewer)

      try {
        await viewer.IFC.applyWebIfcConfig(IFC_LOADER_SETTINGS)
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
        lastLoadSourceRef.current = { kind: 'none' }
        resetTree()
      }
    },
    [
      clearOffsetArtifacts,
      ensureViewer,
      rebuildTreeForModel,
      resetSelection,
      resetTree
    ]
  )

  const loadModelRef = useRef(loadModel)
  useEffect(() => {
    loadModelRef.current = loadModel
  }, [loadModel])

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
      setActiveModelId(null)
      offsetsRestoredRef.current = null
      roomNumbersRef.current = new Map()
    }
  }, [clearOffsetArtifacts, ensureViewer, resetTree, stopWalkMovementLoop])

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
        (viewer) => loadIfcWithCustomSettings(viewer, { file: nextSource.file }, true),
        'Loading IFC file...'
      )
      return
    }

    if (nextSource.kind === 'url') {
      void loadModelRef.current(
        (viewer) => loadIfcWithCustomSettings(viewer, { url: nextSource.url }, true),
        'Loading sample model...'
      )
      return
    }

    setStatus(null)
  }, [defaultModelUrl, file, loadIfcWithCustomSettings])

  return (
    <>
      <div className="viewer-wrapper">
        <div className="viewer-layout">
          <div className="viewer-stage">
            <div ref={containerRef} className="viewer-container" />
            <CoordsOverlay hoverCoords={hoverCoords} />
            <InsertMenu
              open={isInsertMenuOpen}
              anchor={insertMenuAnchor}
              onInsertCube={() => {
                spawnUnitCube()
                closeInsertMenu()
              }}
              onUploadClick={() => uploadInputRef.current?.click()}
              onCancel={closeInsertMenu}
            />
            <SelectionMenu
              open={isPickMenuOpen}
              anchor={pickMenuAnchor}
              candidates={pickMenuItems}
              onSelect={handlePickMenuSelect}
              onCancel={closePickMenu}
            />
            <button
              type="button"
              className={`navigation-toggle${showShortcuts ? ' navigation-toggle--with-shortcuts' : ''}${isWalkMode ? ' navigation-toggle--walk' : ''}`}
              onClick={toggleNavigationMode}
              title={isWalkMode ? 'Switch to free look mode' : 'Switch to walk mode'}
            >
              {isWalkMode ? 'Walk' : 'Free'}
            </button>
            {status && <div className="viewer-overlay">{status}</div>}
            {error && <div className="viewer-overlay viewer-overlay--error">{error}</div>}
            {showShortcuts && (
              <>
                <button
                  type="button"
                  className="shortcuts-toggle"
                  onClick={() => setIsShortcutsOpen((prev) => !prev)}
                  title="Keyboard shortcuts"
                >
                  ?
                </button>
                <ShortcutsOverlay
                  open={isShortcutsOpen}
                  shortcuts={SHORTCUTS}
                  onClose={() => setIsShortcutsOpen(false)}
                />
              </>
            )}
          </div>

          {showSidePanel && (
            <div className="side-panel">
              {showTree && (
                <ObjectTreePanel
                  tree={tree}
                  selectedNodeId={selectedNodeId}
                  onSelectNode={handleTreeSelect}
                  rooms={roomOptions}
                  onSelectRoom={handleRoomSelect}
                  onAddCube={handleTreeAddCube}
                  onUploadModel={handleTreeUploadModel}
                />
              )}
              {showProperties && (
                <PropertiesPanel
                  selectedElement={selectedElement}
                  isFetchingProperties={isFetchingProperties}
                  propertyError={propertyError}
                  offsetInputs={offsetInputs}
                  onOffsetChange={handleOffsetInputChange}
                  onApplyOffset={applyOffsetAndPersist}
                  shortcutsHint={showShortcuts ? 'Shortcuts: press ? or H' : undefined}
                  onShowShortcuts={showShortcuts ? () => setIsShortcutsOpen(true) : undefined}
                  onDeleteSelected={selectedElement ? handleDeleteSelected : undefined}
                  deleteLabel={
                    selectedElement?.modelID === CUSTOM_CUBE_MODEL_ID
                      ? 'Delete object'
                      : 'Delete element'
                  }
                  elementName={selectedElementName}
                  historyEntries={selectedHistoryEntries}
                  propertyFields={propertyFields}
                  onFieldChange={handlePropertyFieldChange}
                />
              )}
            </div>
          )}
        </div>
      </div>
      <input
        type="file"
        accept=".ifc"
        style={{ display: 'none' }}
        ref={uploadInputRef}
        onChange={async (event) => {
          const inputFile = event.target.files?.[0]
          if (inputFile) {
            await spawnUploadedModelAt(inputFile)
          }
          event.target.value = ''
          closeInsertMenu()
        }}
      />
      <input
        type="file"
        accept=".ifc"
        style={{ display: 'none' }}
        ref={treeUploadInputRef}
        onChange={handleTreeUploadInputChange}
      />
    </>
  )
}

export default IfcViewer


