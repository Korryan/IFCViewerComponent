import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { IfcViewerAPI } from './viewer/IfcViewerAPICompat'
import type {
  FurnitureItem,
  HistoryEntry,
  InsertPrefabOption,
  MetadataEntry,
  Point3D,
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
import { useObjectTree } from './hooks/useObjectTree'
import { type StoreyInfo } from './ifcRoomTree.utils'
import {
  CUBE_ITEM_PREFIX,
  INVERSE_COORDINATION_MATRIX_CUSTOM_KEY,
  MODEL_LOAD_TIMEOUT_MS,
  POSITION_EPSILON,
  ROOM_SELECT_Y_OFFSET,
  SPACE_RELATIVE_POSITION_CUSTOM_KEY,
  SHORTCUTS,
  wasmRootPath
} from './ifcViewer.constants'
import {
  isSameLoadSource,
  parseCubeId,
  sanitizeHistoryEntries,
  sanitizeMetadataEntries,
  withTimeout,
  type LoadSource
} from './ifcViewer.utils'
import {
  removeIfcModelSafely,
  tuneIfcModelMaterials
} from './ifcViewer.modelCleanup'
import {
  clearLoadedViewerModels,
  loadIfcModelWithSettings,
  type Loader
} from './ifcViewer.loading'
import {
  buildUpdatedIfcMetadataEntry,
  injectMissingInverseCoordinationMatrix,
  serializeInverseCoordinationMatrix
} from './ifcViewer.persistence'
import {
  buildRoomOptions,
  buildTreeNodeSelectionMap,
  collectIfcIdsInSubtree as collectIfcIdsInTreeSubtree,
  isTreeNodeEditableWithinRoom,
  resolveContainingRoomNodeId as resolveContainingRoomNodeIdInTree,
  type RoomListEntry
} from './ifcViewer.rooms'
import { collectMaterializedFurnitureItemIds } from './ifcViewer.furnitureReconciliation'
import { rebuildIfcTreeForModel } from './ifcViewer.treeHydration'
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
  prefabs?: InsertPrefabOption[]
  onMetadataChange?: (entries: MetadataEntry[]) => void
  onFurnitureChange?: (items: FurnitureItem[]) => void
  onHistoryChange?: (items: HistoryEntry[]) => void
  onSelectionChange?: (selection: SelectedElement | null) => void
  onResolvePrefabFile?: (prefabId: string) => Promise<File | null>
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
  prefabs = [],
  onMetadataChange,
  onFurnitureChange,
  onHistoryChange,
  onSelectionChange,
  onResolvePrefabFile
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
  const [lastWalkRoomNodeId, setLastWalkRoomNodeId] = useState<string | null>(null)
  const [roomOnlyTransformGuard, setRoomOnlyTransformGuard] = useState(true)
  const [metadataEntries, setMetadataEntries] = useState<MetadataEntry[]>([])
  const [historyEntries, setHistoryEntries] = useState<HistoryEntry[]>([])
  const [isHydrated, setIsHydrated] = useState(false)
  const [isFurnitureStateReconciled, setIsFurnitureStateReconciled] = useState(false)
  const furnitureRestoredRef = useRef(false)
  const offsetsRestoredRef = useRef<number | null>(null)
  const [activeModelId, setActiveModelId] = useState<number | null>(null)
  const [storeyInfoByNodeId, setStoreyInfoByNodeId] = useState<Record<string, StoreyInfo>>({})
  const roomNumbersRef = useRef<Map<number, string>>(new Map())
  const activeIfcTextRef = useRef<string | null>(null)
  const activeModelInverseCoordinationMatrixRef = useRef<number[] | null>(null)
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
    getIfcElementPlacementPosition,
    ensureIfcPlacementPosition,
    getIfcElementTranslationDelta,
    getIfcElementRotationDelta,
    getElementWorldPosition,
    moveSelectedTo,
    rotateSelectedTo,
    getSelectedWorldPosition,
    hideIfcElement,
    setCustomCubeRoomNumber,
    setCustomObjectSpaceIfcId,
    setCustomObjectItemId,
    findCustomObjectExpressIdByItemId,
    getCustomObjectState,
    ensureCustomCubesPickable,
    pickCandidatesAt,
    resetSelection,
    clearOffsetArtifacts,
    spawnCube,
    removeCustomCube,
    spawnUploadedModel,
    spawnStoredCustomObject,
    applyIfcElementOffset,
    applyIfcElementRotation,
    applyVisibilityFilter
  } = useSelectionOffsets(viewerRef)

  // This prepares the persisted custom payload for inserted objects from the current viewer state.
  const buildFurnitureCustom = useCallback(
    async (args?: {
      position?: { x: number; y: number; z: number } | null
      spaceIfcId?: number | null
      extraCustom?: Record<string, string>
    }) => {
      const custom: Record<string, string> = { ...(args?.extraCustom ?? {}) }
      const serializedInverseMatrix = serializeInverseCoordinationMatrix(
        activeModelInverseCoordinationMatrixRef.current
      )
      if (serializedInverseMatrix) {
        custom[INVERSE_COORDINATION_MATRIX_CUSTOM_KEY] = serializedInverseMatrix
      }

      const position = args?.position ?? null
      const spaceIfcId = args?.spaceIfcId ?? null
      if (
        position &&
        typeof activeModelId === 'number' &&
        Number.isFinite(spaceIfcId) &&
        spaceIfcId !== null
      ) {
        const spacePosition =
          getElementWorldPosition(activeModelId, spaceIfcId) ??
          getIfcElementPlacementPosition(activeModelId, spaceIfcId) ??
          (await ensureIfcPlacementPosition(activeModelId, spaceIfcId))
        if (spacePosition) {
          custom[SPACE_RELATIVE_POSITION_CUSTOM_KEY] = JSON.stringify({
            x: position.x - spacePosition.x,
            y: position.y - spacePosition.y,
            z: position.z - spacePosition.z
          })
        }
      }

      return Object.keys(custom).length > 0 ? custom : undefined
    },
    [activeModelId, ensureIfcPlacementPosition, getElementWorldPosition, getIfcElementPlacementPosition]
  )

  const {
    furnitureEntries,
    setFurnitureEntries,
    suppressNextFurnitureNotify,
    upsertFurnitureItem,
    registerUploadedFurniture
  } = useFurnitureState({
    furniture,
    isHydrated,
    onFurnitureChange,
    setCustomCubeRoomNumber,
    setCustomObjectSpaceIfcId,
    setCustomObjectItemId,
    buildFurnitureCustom
  })

  const ensureViewer = useViewerSetup(containerRef, viewerRef, wasmRootPath)
  const metadataMap = useMemo(
    () => new Map(metadataEntries.map((entry) => [entry.ifcId, entry])),
    [metadataEntries]
  )

  useEffect(() => {
    const serializedMatrix = serializeInverseCoordinationMatrix(
      activeModelInverseCoordinationMatrixRef.current
    )
    if (!serializedMatrix) return
    setFurnitureEntries((prev) => injectMissingInverseCoordinationMatrix(prev, serializedMatrix))
  }, [activeModelId, setFurnitureEntries])

  useEffect(() => {
    const serializedMatrix = serializeInverseCoordinationMatrix(
      activeModelInverseCoordinationMatrixRef.current
    )
    if (!serializedMatrix) return
    setMetadataEntries((prev) => injectMissingInverseCoordinationMatrix(prev, serializedMatrix))
  }, [activeModelId])

  const deletedIfcIds = useMemo(() => {
    const ids = new Set<number>()
    metadataEntries.forEach((entry) => {
      if (entry.deleted) {
        ids.add(entry.ifcId)
      }
    })
    return ids
  }, [metadataEntries])
  const roomOptions = useMemo<RoomListEntry[]>(
    () =>
      buildRoomOptions({
        tree,
        storeyInfoByNodeId,
        roomNumbers: roomNumbersRef.current
      }),
    [storeyInfoByNodeId, tree]
  )
  const treeNodeBySelectionKey = useMemo(() => buildTreeNodeSelectionMap(tree.nodes), [tree.nodes])
  const resolveTreeNodeIdForSelection = useCallback(
    (modelID: number, expressID: number): string | null => {
      return treeNodeBySelectionKey.get(`${modelID}:${expressID}`) ?? null
    },
    [treeNodeBySelectionKey]
  )
  const resolveContainingRoomNodeId = useCallback(
    (nodeId: string | null | undefined): string | null =>
      resolveContainingRoomNodeIdInTree(tree.nodes, nodeId),
    [tree.nodes]
  )
  const isNodeEditableWithinRoom = useCallback(
    (nodeId: string | null | undefined): boolean => isTreeNodeEditableWithinRoom(tree.nodes, nodeId),
    [tree.nodes]
  )
  const selectedTransformNodeId = useMemo(() => {
    if (!selectedElement) return null
    return resolveTreeNodeIdForSelection(selectedElement.modelID, selectedElement.expressID)
  }, [resolveTreeNodeIdForSelection, selectedElement])
  const canTransformSelected = useMemo(() => {
    if (!selectedElement) return false
    if (!roomOnlyTransformGuard) return true
    return isNodeEditableWithinRoom(selectedTransformNodeId)
  }, [isNodeEditableWithinRoom, roomOnlyTransformGuard, selectedElement, selectedTransformNodeId])
  const transformGuardReason = useMemo(() => {
    if (!roomOnlyTransformGuard || !selectedElement || canTransformSelected) return null
    return 'Movement and rotation are locked for elements outside rooms.'
  }, [canTransformSelected, roomOnlyTransformGuard, selectedElement])
  const roomOptionsByNodeId = useMemo(
    () => new Map(roomOptions.map((room) => [room.nodeId, room])),
    [roomOptions]
  )
  const walkRoomContents = useMemo(() => {
    if (!lastWalkRoomNodeId) return null
    return roomOptionsByNodeId.get(lastWalkRoomNodeId) ?? null
  }, [lastWalkRoomNodeId, roomOptionsByNodeId])
  const showSidePanel = showTree || showProperties

  // This loads an IFC source while capturing the raw text and coordination matrix used by later editors.
  const loadIfcWithCustomSettings = useCallback(
    async (viewer: IfcViewerAPI, source: { file?: File; url?: string }, fitToFrame: boolean) => {
      activeModelInverseCoordinationMatrixRef.current = null
      activeIfcTextRef.current = null
      const loaded = await loadIfcModelWithSettings({
        viewer,
        source,
        fitToFrame
      })
      activeIfcTextRef.current = loaded?.ifcText ?? null
      activeModelInverseCoordinationMatrixRef.current = loaded?.inverseCoordinationMatrix ?? null
      return loaded?.model ?? null
    },
    []
  )

  // This appends one history record while keeping the newest edits for the same element near the top.
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

  // This inserts or updates one metadata entry without rebuilding the whole metadata array manually.
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

  // This syncs a selected custom object back into the furniture state after a transform.
  const syncSelectedCubePosition = useCallback(() => {
    if (!selectedElement || selectedElement.modelID !== CUSTOM_CUBE_MODEL_ID) return
    const pos = getSelectedWorldPosition()
    if (!pos) return
    const customState = getCustomObjectState(selectedElement.expressID)
    const itemId = customState?.itemId ?? `${CUBE_ITEM_PREFIX}${selectedElement.expressID}`
    const model = customState?.model ?? 'cube'
    const existingItem = furnitureEntries.find((item) => item.id === itemId)
    const spaceIfcId = existingItem?.spaceIfcId ?? customState?.spaceIfcId
    const roomNumber = existingItem?.roomNumber ?? customState?.roomNumber
    const rotation = getIfcElementRotationDelta(selectedElement.modelID, selectedElement.expressID)
    void (async () => {
      const custom = await buildFurnitureCustom({
        position: { x: pos.x, y: pos.y, z: pos.z },
        spaceIfcId,
        extraCustom: existingItem?.custom
      })
      upsertFurnitureItem({
        id: itemId,
        model,
        name: customState?.name,
        position: { x: pos.x, y: pos.y, z: pos.z },
        rotation: rotation
          ? { x: rotation.x, y: rotation.y, z: rotation.z }
          : { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
        roomNumber,
        spaceIfcId,
        custom
      })
    })()
  }, [
    buildFurnitureCustom,
    furnitureEntries,
    getCustomObjectState,
    getIfcElementRotationDelta,
    getSelectedWorldPosition,
    selectedElement,
    upsertFurnitureItem
  ])

  // This syncs a selected IFC element back into persisted metadata after a transform.
  const syncSelectedIfcPosition = useCallback(() => {
    if (!selectedElement || selectedElement.modelID === CUSTOM_CUBE_MODEL_ID) return
    const resolved =
      getElementWorldPosition(selectedElement.modelID, selectedElement.expressID) ?? {
        x: offsetInputs.dx,
        y: offsetInputs.dy,
        z: offsetInputs.dz
      }
    const placementPosition = getIfcElementPlacementPosition(
      selectedElement.modelID,
      selectedElement.expressID
    )
    const translationDelta = getIfcElementTranslationDelta(selectedElement.modelID, selectedElement.expressID)
    const rotationDelta = getIfcElementRotationDelta(selectedElement.modelID, selectedElement.expressID)
    const base = getIfcElementBasePosition(selectedElement.modelID, selectedElement.expressID) ?? resolved
    upsertMetadataEntry(selectedElement.expressID, (existing) =>
      buildUpdatedIfcMetadataEntry({
        existing,
        ifcId: selectedElement.expressID,
        resolvedType: selectedElement.type,
        resolvedPosition: resolved,
        basePosition: base,
        translationDelta,
        rotationDelta,
        placementPosition,
        inverseCoordinationMatrix: activeModelInverseCoordinationMatrixRef.current
      })
    )
  }, [
    getElementWorldPosition,
    getIfcElementBasePosition,
    getIfcElementPlacementPosition,
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
    canTransformSelected,
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
    findSpaceNodeIdByIfcId,
    resolveNodeInsertTarget,
    spawnUploadedModelAt,
    spawnPrefabAt,
    handleTreeInsertPrefab,
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
    registerUploadedFurniture,
    selectById,
    getElementWorldPosition,
    getIfcElementPlacementPosition,
    ensureIfcPlacementPosition,
    selectCustomCube,
    spawnUploadedModel
  })

  // This persists property edits either to custom furniture state or IFC metadata overrides.
  const handlePropertyFieldChange = useCallback(
    (key: string, value: string) => {
      const previousValue = propertyFields.find((field) => field.key === key)?.value
      const fieldLabel = propertyFields.find((field) => field.key === key)?.label ?? key
      handleFieldChange(key, value)
      if (!selectedElement) {
        return
      }
      if (selectedElement.modelID === CUSTOM_CUBE_MODEL_ID) {
        const customState = getCustomObjectState(selectedElement.expressID)
        const itemId = customState?.itemId ?? `${CUBE_ITEM_PREFIX}${selectedElement.expressID}`
        const existingItem = furnitureEntries.find((item) => item.id === itemId)
        upsertFurnitureItem({
          id: itemId,
          model: customState?.model ?? 'cube',
          name:
            key === 'name'
              ? value
              : customState?.name ??
                propertyFields.find((field) => field.key === 'name')?.value ??
                `Object #${selectedElement.expressID}`,
          custom:
            key === 'name'
              ? undefined
              : {
                  ...(existingItem?.custom ?? {}),
                  [key]: value
                },
          position:
            existingItem?.position ??
            getElementWorldPosition(selectedElement.modelID, selectedElement.expressID) ?? {
              x: offsetInputs.dx,
              y: offsetInputs.dy,
              z: offsetInputs.dz
            },
          roomNumber: existingItem?.roomNumber ?? customState?.roomNumber,
          spaceIfcId: existingItem?.spaceIfcId ?? customState?.spaceIfcId
        })
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
    [
      furnitureEntries,
      getCustomObjectState,
      getElementWorldPosition,
      handleFieldChange,
      offsetInputs,
      propertyFields,
      pushHistoryEntry,
      selectedElement,
      upsertFurnitureItem,
      upsertMetadataEntry
    ]
  )

  // This applies the current transform inputs and immediately persists the resulting element state.
  const applyOffsetAndPersist = useCallback(() => {
    if (!canTransformSelected) return
    applyOffsetToSelectedElement()
    syncSelectedCubePosition()
    syncSelectedIfcPosition()
    if (selectedElement && selectedElement.modelID !== CUSTOM_CUBE_MODEL_ID) {
      pushHistoryEntry(selectedElement.expressID, 'Position updated')
    }
  }, [
    applyOffsetToSelectedElement,
    canTransformSelected,
    pushHistoryEntry,
    selectedElement,
    syncSelectedCubePosition,
    syncSelectedIfcPosition
  ])

  // This deletes custom objects directly and marks IFC elements as deleted for export.
  const handleDeleteSelected = useCallback(() => {
    if (!selectedElement) return

    // Custom objects: hard delete (remove mesh + tree node + furniture entry).
    if (selectedElement.modelID === CUSTOM_CUBE_MODEL_ID) {
      const customId = selectedElement.expressID
      const customState = getCustomObjectState(customId)
      const fallbackItemId = `${CUBE_ITEM_PREFIX}${customId}`
      removeCustomCube(customId)
      const nextFurniture = furnitureEntries.filter(
        (item) => item.id !== (customState?.itemId ?? fallbackItemId)
      )
      if (onFurnitureChange) {
        suppressNextFurnitureNotify()
        onFurnitureChange(nextFurniture)
      }
      setFurnitureEntries(nextFurniture)
      const nodeId = Object.values(tree.nodes).find(
        (node) =>
          node.nodeType === 'custom' &&
          node.modelID === CUSTOM_CUBE_MODEL_ID &&
          node.expressID === customId
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
    getCustomObjectState,
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
    if (!isHydrated || activeModelId === null || tree.roots.length === 0) return

    const viewer = ensureViewer()
    if (!viewer) {
      setIsFurnitureStateReconciled(true)
      return
    }

    let cancelled = false
    void (async () => {
      const materializedItemIds = await collectMaterializedFurnitureItemIds({
        viewer,
        tree,
        modelID: activeModelId,
        furnitureEntries
      })
      if (cancelled) return

      if (materializedItemIds.size > 0) {
        const customExpressIds = furnitureEntries
          .map((item) => {
            if (!materializedItemIds.has(item.id)) return null
            return item.model === 'cube'
              ? parseCubeId(item.id)
              : findCustomObjectExpressIdByItemId(item.id)
          })
          .filter((expressID): expressID is number => typeof expressID === 'number')

        customExpressIds.forEach((expressID) => {
          removeCustomCube(expressID)
          const customNode = Object.values(tree.nodes).find(
            (node) =>
              node.nodeType === 'custom' &&
              node.modelID === CUSTOM_CUBE_MODEL_ID &&
              node.expressID === expressID
          )
          if (customNode) {
            removeNode(customNode.id)
          }
        })

        setFurnitureEntries((prev) =>
          prev.filter((item) => !materializedItemIds.has(item.id))
        )
      }

      setIsFurnitureStateReconciled(true)
    })()

    return () => {
      cancelled = true
    }
  }, [
    activeModelId,
    ensureViewer,
    findCustomObjectExpressIdByItemId,
    furnitureEntries,
    isHydrated,
    removeCustomCube,
    removeNode,
    setFurnitureEntries,
    tree
  ])

  useEffect(() => {
    if (!isHydrated || furnitureRestoredRef.current || activeModelId === null || tree.roots.length === 0) return
    if (!isFurnitureStateReconciled) return
    const viewer = ensureViewer()
    if (!viewer) return
    furnitureEntries.forEach((item) => {
      let info: { expressID: number; position: Point3D } | null = null
      if (item.model === 'cube') {
        const cubeId = parseCubeId(item.id)
        if (!cubeId) return
        info = spawnCube(item.position, { id: cubeId, focus: false })
      } else if (item.geometry) {
        info = spawnStoredCustomObject({
          itemId: item.id,
          model: item.model,
          name: item.name,
          position: item.position,
          rotation: item.rotation,
          geometry: item.geometry,
          roomNumber: item.roomNumber,
          spaceIfcId: item.spaceIfcId,
          sourceFileName: item.custom?.sourceFileName ?? null,
          focus: false
        })
      }
      if (!info) return
      setCustomCubeRoomNumber(info.expressID, item.roomNumber)
      setCustomObjectSpaceIfcId(info.expressID, item.spaceIfcId)
      const parentId = findSpaceNodeIdByIfcId(item.spaceIfcId) ?? findSpaceNodeIdByRoomNumber(item.roomNumber)
      addCustomNode({
        modelID: CUSTOM_CUBE_MODEL_ID,
        expressID: info.expressID,
        label: item.model === 'cube' ? `Cube #${info.expressID}` : item.name ?? item.id,
        type: item.model === 'cube' ? 'CUBE' : 'FURNITURE',
        parentId
      })
    })
    furnitureRestoredRef.current = true
  }, [
    addCustomNode,
    activeModelId,
    ensureViewer,
    findSpaceNodeIdByIfcId,
    findSpaceNodeIdByRoomNumber,
    furnitureEntries,
    isFurnitureStateReconciled,
    isHydrated,
    setCustomCubeRoomNumber,
    spawnStoredCustomObject,
    tree.roots.length,
    spawnCube
  ])

  useEffect(() => {
    if (activeModelId === null) return
    ensureCustomCubesPickable()
  }, [activeModelId, ensureCustomCubesPickable])

  useEffect(() => {
    if (!isHydrated || !isFurnitureStateReconciled || tree.roots.length === 0) return
    const existing = new Set<number>()
    Object.values(tree.nodes).forEach((node) => {
      if (node.nodeType === 'custom' && node.modelID === CUSTOM_CUBE_MODEL_ID && node.expressID !== null) {
        existing.add(node.expressID)
      }
    })
    furnitureEntries.forEach((item) => {
      let expressID: number | null = null
      if (item.model === 'cube') {
        const cubeId = parseCubeId(item.id)
        if (!cubeId) return
        expressID = cubeId
      } else {
        expressID = findCustomObjectExpressIdByItemId(item.id)
      }
      if (!expressID || existing.has(expressID)) return
      const parentId = findSpaceNodeIdByIfcId(item.spaceIfcId) ?? findSpaceNodeIdByRoomNumber(item.roomNumber)
      addCustomNode({
        modelID: CUSTOM_CUBE_MODEL_ID,
        expressID,
        label: item.model === 'cube' ? `Cube #${expressID}` : item.name ?? item.id,
        type: item.model === 'cube' ? 'CUBE' : 'FURNITURE',
        parentId
      })
    })
  }, [
    addCustomNode,
    findCustomObjectExpressIdByItemId,
    findSpaceNodeIdByIfcId,
    findSpaceNodeIdByRoomNumber,
    furnitureEntries,
    isFurnitureStateReconciled,
    isHydrated,
    tree.nodes,
    tree.roots
  ])

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
    [resetTree, setIfcTree]
  )

  const collectIfcIdsInSubtree = useCallback(
    (rootNodeId: string): { modelID: number | null; ids: number[] } =>
      collectIfcIdsInTreeSubtree(tree, rootNodeId),
    [tree]
  )

  // This maps a tree click to either a custom object selection or an IFC highlight/selection flow.
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

  // This focuses the selected room and updates the active room context used by the side panel.
  const handleRoomSelect = useCallback(
    async (nodeId: string) => {
      setLastWalkRoomNodeId(nodeId)
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
    if (!selectedElement) return

    const matchId = resolveTreeNodeIdForSelection(selectedElement.modelID, selectedElement.expressID)
    setSelectedNodeId(matchId)
    const roomNodeId = resolveContainingRoomNodeId(matchId)
    if (isWalkMode && roomNodeId) {
      setLastWalkRoomNodeId((current) => (current === roomNodeId ? current : roomNodeId))
      return
    }
    if (roomNodeId && roomNodeId === matchId) {
      setLastWalkRoomNodeId((current) => (current === roomNodeId ? current : roomNodeId))
    }
  }, [isWalkMode, resolveContainingRoomNodeId, resolveTreeNodeIdForSelection, selectedElement])

  useEffect(() => {
    if (!lastWalkRoomNodeId) return
    if (tree.nodes[lastWalkRoomNodeId]) return
    setLastWalkRoomNodeId(null)
  }, [lastWalkRoomNodeId, tree.nodes])

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

      // Reuse the existing viewer so repeated file loads do not leak WebGL contexts.
      const existingViewer = viewerRef.current
      if (existingViewer) {
        stopWalkMovementLoop()
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
      clearOffsetArtifacts,
      ensureViewer,
      rebuildTreeForModel,
      stopWalkMovementLoop,
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
      setLastWalkRoomNodeId(null)
      setActiveModelId(null)
      setIsFurnitureStateReconciled(false)
      offsetsRestoredRef.current = null
      furnitureRestoredRef.current = false
      roomNumbersRef.current = new Map()
      setStoreyInfoByNodeId({})
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

  // This resolves a prefab file and inserts it either at the requested node or at the current cursor target.
  const handleInsertPrefab = useCallback(
    async (prefabId: string, nodeId?: string | null) => {
      if (!onResolvePrefabFile) {
        setError('Prefab loading is not configured.')
        return
      }

      const prefab = prefabs.find((item) => item.prefabId === prefabId)
      try {
        setError(null)
        setStatus(prefab ? `Loading prefab ${prefab.fileName}...` : 'Loading prefab...')
        const prefabFile = await onResolvePrefabFile(prefabId)
        if (!prefabFile) {
          setStatus(null)
          setError('Failed to load prefab IFC file.')
          return
        }

        if (nodeId) {
          await handleTreeInsertPrefab(nodeId, prefabFile)
        } else {
          await spawnPrefabAt(prefabFile)
        }
        setStatus(null)
      } catch (err) {
        console.error('Failed to insert prefab', err)
        setStatus(null)
        setError('Failed to insert prefab IFC file.')
      }
    },
    [handleTreeInsertPrefab, onResolvePrefabFile, prefabs, spawnPrefabAt]
  )

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
              prefabs={prefabs}
              onInsertPrefab={(prefabId) => {
                void handleInsertPrefab(prefabId)
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
              <div className={`viewer-mode-controls${showShortcuts ? ' viewer-mode-controls--with-shortcuts' : ''}`}>
                <button
                  type="button"
                  className={`navigation-toggle${isWalkMode ? ' navigation-toggle--walk' : ''}`}
                  onClick={toggleNavigationMode}
                  title={isWalkMode ? 'Switch to free look mode' : 'Switch to walk mode'}
                >
                  {isWalkMode ? 'Walk mode' : 'Free mode'}
                </button>
                <button
                  type="button"
                  className={`navigation-toggle navigation-toggle--room-guard${roomOnlyTransformGuard ? ' navigation-toggle--room-guard-active' : ''}`}
                  onClick={() => setRoomOnlyTransformGuard((prev) => !prev)}
                  aria-pressed={roomOnlyTransformGuard}
                  title="Lock movement and rotation for elements outside rooms"
                >
                  Room-only edit {roomOnlyTransformGuard ? 'On' : 'Off'}
                </button>
              </div>
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
                  roomContents={walkRoomContents}
                  activeRoomNodeId={lastWalkRoomNodeId}
                  onSelectRoom={handleRoomSelect}
                  prefabs={prefabs}
                  onInsertPrefab={(nodeId, prefabId) => {
                    void handleInsertPrefab(prefabId, nodeId)
                  }}
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
                    canTransformSelected={canTransformSelected}
                    transformGuardReason={transformGuardReason}
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


