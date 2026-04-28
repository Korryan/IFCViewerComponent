import { useCallback, useEffect, useMemo } from 'react'
import type { Dispatch, MutableRefObject, SetStateAction } from 'react'
import type { FurnitureItem, HistoryEntry, MetadataEntry, ObjectTreeNode, OffsetVector, Point3D, PropertyField, SelectedElement } from './ifcViewerTypes'
import { CUBE_ITEM_PREFIX } from './ifcViewer.constants'
import { CUSTOM_CUBE_MODEL_ID } from './hooks/selectionOffsets.shared'
import { buildUpdatedIfcMetadataEntry } from './ifcViewer.persistence'
import { sanitizeHistoryEntries, sanitizeMetadataEntries } from './ifcViewer.savedState'

type SetState<T> = Dispatch<SetStateAction<T>>

type UseIfcViewerSelectionPersistenceArgs = {
  metadata?: MetadataEntry[]
  furniture?: FurnitureItem[]
  history?: HistoryEntry[]
  metadataEntries: MetadataEntry[]
  setMetadataEntries: SetState<MetadataEntry[]>
  furnitureEntries: FurnitureItem[]
  setFurnitureEntries: SetState<FurnitureItem[]>
  historyEntries: HistoryEntry[]
  setHistoryEntries: SetState<HistoryEntry[]>
  setIsHydrated: (value: boolean) => void
  isHydrated: boolean
  onMetadataChange?: (entries: MetadataEntry[]) => void
  onFurnitureChange?: (items: FurnitureItem[]) => void
  onHistoryChange?: (items: HistoryEntry[]) => void
  onSelectionChange?: (selection: SelectedElement | null) => void
  suppressMetadataNotifyRef: MutableRefObject<boolean>
  suppressHistoryNotifyRef: MutableRefObject<boolean>
  suppressNextFurnitureNotify: () => void
  metadataMap: Map<number, MetadataEntry>
  selectedElement: SelectedElement | null
  propertyFields: PropertyField[]
  offsetInputs: OffsetVector
  selectedNodeIdSetter: (nodeId: string | null) => void
  treeNodes: Record<string, ObjectTreeNode>
  removeNode: (nodeId: string) => void
  getSelectedWorldPosition: () => { x: number; y: number; z: number } | null
  getCustomObjectState: (expressID: number) => {
    itemId?: string | null
    model?: string | null
    name?: string | null
    roomNumber?: string | null
    spaceIfcId?: number | null
  } | null
  getIfcElementRotationDelta: (modelID: number, expressID: number) => Point3D | null
  upsertFurnitureItem: (nextItem: FurnitureItem) => void
  buildFurnitureCustom: (args?: {
    position?: { x: number; y: number; z: number } | null
    spaceIfcId?: number | null
    extraCustom?: Record<string, string>
  }) => Promise<Record<string, string> | undefined>
  getElementWorldPosition: (modelID: number, expressID: number) => Point3D | null
  getIfcElementPlacementPosition: (modelID: number, expressID: number) => Point3D | null
  getIfcElementTranslationDelta: (modelID: number, expressID: number) => Point3D | null
  getIfcElementBasePosition: (modelID: number, expressID: number) => Point3D | null
  activeModelInverseCoordinationMatrixRef: MutableRefObject<number[] | null>
  handleFieldChange: (key: string, value: string) => void
  applyOffsetToSelectedElement: () => void
  canTransformSelected: boolean
  removeCustomCube: (expressID: number) => void
  hideIfcElement: (modelID: number, expressID: number) => void
  resetSelection: () => void
}

type UseIfcViewerSelectionPersistenceResult = {
  pushHistoryEntry: (ifcId: number, label: string, timestamp?: string) => void
  selectedElementName: string | null
  selectedHistoryEntries: HistoryEntry[]
  syncSelectedCubePosition: () => void
  syncSelectedIfcPosition: () => void
  handlePropertyFieldChange: (key: string, value: string) => void
  applyOffsetAndPersist: () => void
  handleDeleteSelected: () => void
}

// Builds the metadata, history, and furniture persistence flow around the current viewer selection.
export const useIfcViewerSelectionPersistence = ({
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
  selectedNodeIdSetter,
  treeNodes,
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
}: UseIfcViewerSelectionPersistenceArgs): UseIfcViewerSelectionPersistenceResult => {
  // This appends one history record while keeping the newest edits for the same element near the top.
  const pushHistoryEntry = useCallback((ifcId: number, label: string, timestamp?: string) => {
    const nextTimestamp = timestamp ?? new Date().toISOString()
    setHistoryEntries((prev) => {
      const remaining = prev.filter((entry) => entry.ifcId !== ifcId)
      const existing = prev.filter((entry) => entry.ifcId === ifcId)
      const next = [{ ifcId, label, timestamp: nextTimestamp }, ...existing].slice(0, 12)
      return [...next, ...remaining]
    })
  }, [setHistoryEntries])

  // This resolves the current display name of the selected element from inspector fields.
  const selectedElementName = useMemo(() => {
    if (!selectedElement) return null
    const nameField = propertyFields.find(
      (field) => field.label.toLowerCase() === 'name' || field.key.toLowerCase() === 'name'
    )
    return nameField?.value || null
  }, [propertyFields, selectedElement])

  // This resolves the history items that belong to the current selection and prepends save timestamps.
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

  // This effect forwards selection changes to the optional parent callback.
  useEffect(() => {
    if (!onSelectionChange) return
    onSelectionChange(selectedElement ?? null)
  }, [onSelectionChange, selectedElement])

  // This function inserts or updates one metadata entry without rebuilding the whole array manually.
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
    [setMetadataEntries]
  )

  // This function syncs a selected custom object back into the furniture state after a transform.
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
        name: customState?.name ?? undefined,
        position: { x: pos.x, y: pos.y, z: pos.z },
        rotation: rotation
          ? { x: rotation.x, y: rotation.y, z: rotation.z }
          : { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
        roomNumber: roomNumber ?? undefined,
        spaceIfcId: spaceIfcId ?? undefined,
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

  // This function syncs a selected IFC element back into persisted metadata after a transform.
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
    activeModelInverseCoordinationMatrixRef,
    getElementWorldPosition,
    getIfcElementBasePosition,
    getIfcElementPlacementPosition,
    getIfcElementRotationDelta,
    getIfcElementTranslationDelta,
    offsetInputs,
    selectedElement,
    upsertMetadataEntry
  ])

  // This function persists property edits either to custom furniture state or IFC metadata overrides.
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
          roomNumber: existingItem?.roomNumber ?? customState?.roomNumber ?? undefined,
          spaceIfcId: existingItem?.spaceIfcId ?? customState?.spaceIfcId ?? undefined
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

  // This function applies the current transform inputs and immediately persists the resulting element state.
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

  // This function deletes custom objects directly and marks IFC elements as deleted for export.
  const handleDeleteSelected = useCallback(() => {
    if (!selectedElement) return

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
      const nodeId = Object.values(treeNodes).find(
        (node) =>
          node.nodeType === 'custom' &&
          node.modelID === CUSTOM_CUBE_MODEL_ID &&
          node.expressID === customId
      )?.id
      if (nodeId) {
        removeNode(nodeId)
      }
      resetSelection()
      selectedNodeIdSetter(null)
      return
    }

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
    selectedNodeIdSetter(null)
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
    selectedNodeIdSetter,
    setFurnitureEntries,
    suppressNextFurnitureNotify,
    treeNodes,
    upsertMetadataEntry
  ])

  // This effect hydrates incoming external state into local metadata and history stores.
  useEffect(() => {
    const hasExternalState = metadata !== undefined || furniture !== undefined || history !== undefined
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
  }, [
    furniture,
    history,
    metadata,
    onFurnitureChange,
    onHistoryChange,
    onMetadataChange,
    setHistoryEntries,
    setIsHydrated,
    setMetadataEntries,
    suppressHistoryNotifyRef,
    suppressMetadataNotifyRef
  ])

  // This effect forwards metadata changes back to the parent once hydration is complete.
  useEffect(() => {
    if (!isHydrated || !onMetadataChange) return
    if (suppressMetadataNotifyRef.current) {
      suppressMetadataNotifyRef.current = false
      return
    }
    onMetadataChange(metadataEntries)
  }, [isHydrated, metadataEntries, onMetadataChange, suppressMetadataNotifyRef])

  // This effect forwards history changes back to the parent with the same debounce used before refactoring.
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
  }, [historyEntries, isHydrated, onHistoryChange, suppressHistoryNotifyRef])

  // This effect reapplies stored custom property overrides whenever a new selection loads fresh fields.
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

  return {
    pushHistoryEntry,
    selectedElementName,
    selectedHistoryEntries,
    syncSelectedCubePosition,
    syncSelectedIfcPosition,
    handlePropertyFieldChange,
    applyOffsetAndPersist,
    handleDeleteSelected
  }
}
