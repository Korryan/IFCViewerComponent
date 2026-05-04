import { forwardRef, useRef, useState } from 'react'
import { IfcViewerAPI } from './viewer/IfcViewerAPICompat'
import type { FurnitureItem, HistoryEntry, InsertPrefabOption, MetadataEntry, SelectedElement, ViewerState } from './ifcViewerTypes'
import { useSelectionOffsets } from './hooks/useSelectionOffsets'
import { useViewerSetup } from './hooks/useViewerSetup'
import { useFurnitureState } from './hooks/useFurnitureState'
import { useInsertActions } from './hooks/useInsertActions'
import { useViewerInteractions } from './hooks/useViewerInteractions'
import { IfcViewerLayout } from './components/IfcViewerLayout'
import { useObjectTree } from './hooks/useObjectTree'
import { type StoreyInfo } from './ifcRoomTree.utils'
import { SHORTCUTS, wasmRootPath } from './ifcViewer.constants'
import { type LoadSource } from './ifcViewer.utils'
import { useIfcViewerSelectionPersistence } from './useIfcViewerSelectionPersistence'
import { useIfcViewerModelLifecycle } from './useIfcViewerModelLifecycle'
import { useIfcViewerBuildFurnitureCustom, useIfcViewerInverseMatrixBackfill } from './useIfcViewerFurnitureCustom'
import { useIfcViewerRoomState } from './useIfcViewerRoomState'
import { useIfcViewerTreeSelection } from './useIfcViewerTreeSelection'
import { useIfcViewerPrefabInsertion } from './useIfcViewerPrefabInsertion'
import { type IfcViewerHandle, useIfcViewerSessionState } from './useIfcViewerSessionState'
import { useIfcViewerDerivedState } from './useIfcViewerDerivedState'
import { useIfcViewerLoadSource } from './useIfcViewerLoadSource'
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
  viewerState?: ViewerState | null
  prefabs?: InsertPrefabOption[]
  onMetadataChange?: (entries: MetadataEntry[]) => void
  onFurnitureChange?: (items: FurnitureItem[]) => void
  onHistoryChange?: (items: HistoryEntry[]) => void
  onSelectionChange?: (selection: SelectedElement | null) => void
  onResolvePrefabFile?: (prefabId: string) => Promise<File | null>
}

export type { IfcViewerHandle }

// Top-level viewer wiring together scene setup, selection hook, and UI overlays
const IfcViewer = forwardRef<IfcViewerHandle, IfcViewerProps>(function IfcViewer({
  file,
  defaultModelUrl,
  showTree = true,
  showProperties = true,
  showShortcuts = true,
  metadata,
  furniture,
  history,
  viewerState,
  prefabs = [],
  onMetadataChange,
  onFurnitureChange,
  onHistoryChange,
  onSelectionChange,
  onResolvePrefabFile
}, ref) {
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
    clearCustomObjects,
    clearOffsetArtifacts,
    spawnCube,
    removeCustomCube,
    spawnUploadedModel,
    spawnStoredCustomObject,
    applyIfcElementOffset,
    applyIfcElementRotation,
    applyVisibilityFilter
  } = useSelectionOffsets(viewerRef)

  const { buildFurnitureCustom } = useIfcViewerBuildFurnitureCustom({
    activeModelId,
    activeModelInverseCoordinationMatrixRef,
    getElementWorldPosition,
    getIfcElementPlacementPosition,
    ensureIfcPlacementPosition
  })

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
  const { metadataMap, deletedIfcIds, showSidePanel, sourceKey } = useIfcViewerDerivedState({
    file,
    defaultModelUrl,
    showTree,
    showProperties,
    metadataEntries
  })
  const loadIfcWithCustomSettings = useIfcViewerLoadSource(
    activeIfcTextRef,
    activeModelInverseCoordinationMatrixRef
  )
  const fitToFrameOnLoad = viewerState == null

  useIfcViewerInverseMatrixBackfill({
    activeModelId,
    activeModelInverseCoordinationMatrixRef,
    setFurnitureEntries,
    setMetadataEntries
  })

  const {
    roomOptions,
    walkRoomContents,
    canTransformSelected,
    transformGuardReason,
    resolveTreeNodeIdForSelection,
    resolveContainingRoomNodeIdForTree
  } = useIfcViewerRoomState({
    tree,
    storeyInfoByNodeId,
    roomNumbersRef,
    selectedElement,
    roomOnlyTransformGuard,
    lastWalkRoomNodeId,
    lastWalkRoomNodeIdSetter: setLastWalkRoomNodeId
  })

  const {
    pushHistoryEntry,
    selectedElementName,
    selectedHistoryEntries,
    syncSelectedCubePosition,
    syncSelectedIfcPosition,
    handlePropertyFieldChange,
    applyOffsetAndPersist,
    handleDeleteSelected
  } = useIfcViewerSelectionPersistence({
    metadata,
    furniture,
    history,
    metadataEntries,
    setMetadataEntries,
    furnitureEntries,
    setFurnitureEntries,
    historyEntries,
    setHistoryEntries,
    setIsHydrated,
    isHydrated,
    onMetadataChange,
    onFurnitureChange,
    onHistoryChange,
    onSelectionChange,
    suppressMetadataNotifyRef,
    suppressHistoryNotifyRef,
    suppressNextFurnitureNotify,
    metadataMap,
    selectedElement,
    propertyFields,
    offsetInputs,
    selectedNodeIdSetter: setSelectedNodeId,
    treeNodes: tree.nodes,
    removeNode,
    getSelectedWorldPosition,
    getCustomObjectState,
    getIfcElementRotationDelta,
    upsertFurnitureItem,
    buildFurnitureCustom,
    getElementWorldPosition,
    getIfcElementPlacementPosition,
    getIfcElementTranslationDelta,
    getIfcElementBasePosition,
    activeModelInverseCoordinationMatrixRef,
    handleFieldChange,
    applyOffsetToSelectedElement,
    canTransformSelected,
    removeCustomCube,
    hideIfcElement,
    resetSelection
  })

  const {
    navigationMode,
    isWalkMode,
    toggleNavigationMode,
    setNavigationMode,
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

  useIfcViewerSessionState({
    ref,
    viewerRef,
    activeModelId,
    sourceKey,
    viewerState,
    navigationMode,
    setNavigationMode,
    roomOnlyTransformGuard,
    setRoomOnlyTransformGuard,
    isShortcutsOpen,
    setIsShortcutsOpen
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
    activeRoomNodeId: lastWalkRoomNodeId,
    setSelectedNodeId,
    roomOnlyTransformGuard,
    setStatus,
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

  useIfcViewerModelLifecycle({
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
    clearCustomObjects,
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
  })

  const {
    handleTreeSelect,
    handleRoomSelect
  } = useIfcViewerTreeSelection({
    tree,
    selectedElement,
    selectedNodeIdSetter: setSelectedNodeId,
    lastWalkRoomNodeIdSetter: setLastWalkRoomNodeId,
    isWalkMode,
    resolveTreeNodeIdForSelection,
    resolveContainingRoomNodeIdForTree,
    clearIfcHighlight,
    selectCustomCube,
    selectById,
    hasRenderableExpressId,
    highlightIfcGroup,
    resetSelection,
    resolveNodeInsertTarget,
    moveCameraToPoint,
    teleportCameraToPoint
  })

  const { handleInsertPrefab } = useIfcViewerPrefabInsertion({
    prefabs,
    onResolvePrefabFile,
    setStatus,
    setError,
    handleTreeInsertPrefab,
    spawnPrefabAt
  })

  return (
    <IfcViewerLayout
      containerRef={containerRef}
      uploadInputRef={uploadInputRef}
      treeUploadInputRef={treeUploadInputRef}
      hoverCoords={hoverCoords}
      isInsertMenuOpen={isInsertMenuOpen}
      insertMenuAnchor={insertMenuAnchor}
      prefabs={prefabs}
      onInsertPrefab={(prefabId) => {
        void handleInsertPrefab(prefabId, lastWalkRoomNodeId)
      }}
      onCloseInsertMenu={closeInsertMenu}
      isPickMenuOpen={isPickMenuOpen}
      pickMenuAnchor={pickMenuAnchor}
      pickMenuItems={pickMenuItems}
      onPickMenuSelect={handlePickMenuSelect}
      onClosePickMenu={closePickMenu}
      isWalkMode={isWalkMode}
      onToggleNavigationMode={toggleNavigationMode}
      roomOnlyTransformGuard={roomOnlyTransformGuard}
      onToggleRoomOnlyTransformGuard={() => setRoomOnlyTransformGuard((prev) => !prev)}
      status={status}
      error={error}
      showShortcuts={showShortcuts}
      isShortcutsOpen={isShortcutsOpen}
      shortcuts={SHORTCUTS}
      onToggleShortcuts={() => setIsShortcutsOpen((prev) => !prev)}
      onCloseShortcuts={() => setIsShortcutsOpen(false)}
      showSidePanel={showSidePanel}
      showTree={showTree}
      showProperties={showProperties}
      tree={tree}
      selectedNodeId={selectedNodeId}
      onSelectNode={(nodeId) => {
        void handleTreeSelect(nodeId)
      }}
      rooms={roomOptions}
      roomContents={walkRoomContents}
      activeRoomNodeId={lastWalkRoomNodeId}
      onSelectRoom={(nodeId) => {
        void handleRoomSelect(nodeId)
      }}
      onInsertPrefabAtNode={(nodeId, prefabId) => {
        void handleInsertPrefab(prefabId, nodeId)
      }}
      onUploadModelAtNode={handleTreeUploadModel}
      selectedElement={selectedElement}
      isFetchingProperties={isFetchingProperties}
      propertyError={propertyError}
      offsetInputs={offsetInputs}
      onOffsetChange={handleOffsetInputChange}
      onApplyOffset={applyOffsetAndPersist}
      canTransformSelected={canTransformSelected}
      transformGuardReason={transformGuardReason}
      onDeleteSelected={selectedElement ? handleDeleteSelected : undefined}
      elementName={selectedElementName}
      historyEntries={selectedHistoryEntries}
      propertyFields={propertyFields}
      onFieldChange={handlePropertyFieldChange}
      onUploadInputChange={async (event) => {
        const inputFile = event.target.files?.[0]
        if (inputFile) {
          const roomTarget = lastWalkRoomNodeId
            ? await resolveNodeInsertTarget(lastWalkRoomNodeId)
            : null
          await spawnUploadedModelAt(inputFile, lastWalkRoomNodeId, roomTarget)
        }
        event.target.value = ''
        closeInsertMenu()
      }}
      onTreeUploadInputChange={handleTreeUploadInputChange}
    />
  )
})

export default IfcViewer


