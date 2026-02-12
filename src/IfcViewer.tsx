import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Plane, Raycaster, Vector3 } from 'three'
import { IfcViewerAPI } from 'web-ifc-viewer'
import { IFCDOOR, IFCSPACE, IFCWALL } from 'web-ifc'
import type {
  FurnitureItem,
  HistoryEntry,
  MetadataEntry,
  ObjectTree,
  OffsetVector,
  Point3D,
  SelectedElement
} from './ifcViewerTypes'
import { useSelectionOffsets, CUSTOM_CUBE_MODEL_ID, type PickCandidate } from './hooks/useSelectionOffsets'
import { useViewerSetup } from './hooks/useViewerSetup'
import { CoordsOverlay } from './components/CoordsOverlay'
import { InsertMenu } from './components/InsertMenu'
import { PropertiesPanel } from './components/PropertiesPanel'
import { ObjectTreePanel } from './components/ObjectTreePanel'
import { ShortcutsOverlay } from './components/ShortcutsOverlay'
import { SelectionMenu } from './components/SelectionMenu'
import { buildIfcTree, groupIfcTreeByRoomNumber, useObjectTree } from './hooks/useObjectTree'
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

const wasmRootPath = '/ifc/'
const CUBE_ITEM_PREFIX = 'cube-'
const POSITION_EPSILON = 1e-4
const IFC_VIEW_FILTERS = [
  { key: 'space', label: 'IfcSpace', typeId: IFCSPACE },
  { key: 'wall', label: 'IfcWall', typeId: IFCWALL },
  { key: 'door', label: 'IfcDoor', typeId: IFCDOOR }
] as const
// Common property names used by authoring tools for room numbers (Pset text values).
const ROOM_NUMBER_KEYS = new Set([
  'raumnummer',
  'roomnumber'
])
const SHORTCUTS = [
  { keys: 'A', label: 'Open insert menu at cursor' },
  { keys: 'G', label: 'Start move mode' },
  { keys: 'X / Y / Z', label: 'Lock axis while moving' },
  { keys: 'F', label: 'Move in floor plane (keep height)' },
  { keys: 'K', label: 'Pick overlapping elements near cursor' },
  { keys: 'Esc', label: 'Cancel drag / close menus' },
  { keys: '? / H', label: 'Toggle shortcuts help' }
]

const normalizeIfcValue = (rawValue: any): string => {
  if (rawValue === null || rawValue === undefined) {
    return ''
  }
  if (typeof rawValue === 'object') {
    if ('value' in rawValue) {
      return rawValue.value === null || rawValue.value === undefined ? '' : String(rawValue.value)
    }
    if (Array.isArray(rawValue)) {
      return rawValue.map((entry) => normalizeIfcValue(entry)).join(', ')
    }
    return ''
  }
  return String(rawValue)
}

const normalizePropertyKey = (value: string): string =>
  value.toLowerCase().replace(/[\s_-]+/g, '')

// Extract a room number string from IFC property sets.
const extractRoomNumber = (properties: any): string | null => {
  const psets = Array.isArray(properties?.psets) ? properties.psets : []
  for (const pset of psets) {
    const props = Array.isArray(pset?.HasProperties) ? pset.HasProperties : []
    for (const prop of props) {
      const rawName = normalizeIfcValue(prop?.Name)
      if (!rawName) continue
      const normalizedName = normalizePropertyKey(rawName)
      if (!ROOM_NUMBER_KEYS.has(normalizedName)) continue
      const rawValue =
        prop?.NominalValue ?? prop?.Value ?? prop?.value ?? prop?.RealValue ?? prop?.IntegerValue ?? prop
      const resolved = normalizeIfcValue(rawValue)
      if (resolved) return resolved
    }
  }
  return null
}

const collectStoreyChildExpressIds = (tree: ObjectTree): number[] => {
  const ids = new Set<number>()
  Object.values(tree.nodes).forEach((node) => {
    if (node.nodeType !== 'ifc') return
    if (node.type.toUpperCase() !== 'IFCBUILDINGSTOREY') return
    node.children.forEach((childId) => {
      const child = tree.nodes[childId]
      if (!child || child.nodeType !== 'ifc' || child.expressID === null) return
      ids.add(child.expressID)
    })
  })
  return Array.from(ids)
}

const buildRoomNumberMap = async (
  viewer: IfcViewerAPI,
  tree: ObjectTree,
  modelID: number
): Promise<Map<number, string>> => {
  // Build a lookup of expressID -> room number from Psets.
  // This is used later to group elements under IfcSpace nodes in the UI tree.
  const expressIds = collectStoreyChildExpressIds(tree)
  if (expressIds.length === 0) return new Map()
  const results = await Promise.all(
    expressIds.map(async (expressID) => {
      try {
        const properties = await viewer.IFC.getProperties(modelID, expressID, true, true)
        const roomNumber = extractRoomNumber(properties)
        return roomNumber ? ([expressID, roomNumber] as const) : null
      } catch (err) {
        console.warn('Failed to read room number for element', expressID, err)
        return null
      }
    })
  )
  const map = new Map<number, string>()
  results.forEach((entry) => {
    if (!entry) return
    map.set(entry[0], entry[1])
  })
  return map
}

const parseCubeId = (id: string): number | null => {
  const trimmed = id.trim()
  if (!trimmed) return null

  if (trimmed.startsWith(CUBE_ITEM_PREFIX)) {
    const parsed = Number(trimmed.slice(CUBE_ITEM_PREFIX.length))
    return Number.isFinite(parsed) ? parsed : null
  }

  const legacyMatch = trimmed.match(/(?:cube[-_:]?)?(\d+)$/i)
  if (!legacyMatch) return null

  const parsed = Number(legacyMatch[1])
  return Number.isFinite(parsed) ? parsed : null
}

const sanitizeMetadataEntries = (entries: MetadataEntry[]): MetadataEntry[] => {
  return entries
    .filter((entry) => entry && typeof entry.ifcId === 'number')
    .map((entry) => {
      const sanitizedCustom: Record<string, string> = {}
      if (entry.custom) {
        Object.entries(entry.custom).forEach(([key, value]) => {
          if (typeof value === 'string') {
            sanitizedCustom[key] = value
          }
        })
      }
      const resolvedType = typeof entry.type === 'string' ? entry.type : undefined
      return {
        ...entry,
        type: resolvedType,
        custom: sanitizedCustom
      }
    })
}

const sanitizeHistoryEntries = (entries: HistoryEntry[]): HistoryEntry[] => {
  return entries
    .filter((entry) => entry && typeof entry.ifcId === 'number' && typeof entry.label === 'string')
    .map((entry) => ({
      ...entry,
      timestamp: typeof entry.timestamp === 'string' ? entry.timestamp : new Date().toISOString()
    }))
}

// Top-level viewer wiring together scene setup, selection hook, and UI overlays
const IfcViewer = ({
  file,
  defaultModelUrl = '/test.ifc',
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
  const treeUploadInputRef = useRef<HTMLInputElement | null>(null)
  const pendingTreeUploadRef = useRef<string | null>(null)
  const filterCacheRef = useRef<Map<number, Map<number, number[]>>>(new Map())
  // Pointer bookkeeping so the insert menu knows where to appear
  const lastPointerPosRef = useRef<{ x: number; y: number }>({ x: 16, y: 16 })
  // Remember the last loaded IFC model id for cleanup
  const lastModelIdRef = useRef<number | null>(null)
  const loadTokenRef = useRef(0)
  const [status, setStatus] = useState<string | null>('Loading sample model...')
  const [error, setError] = useState<string | null>(null)
  const [hoverCoords, setHoverCoords] = useState<Point3D | null>(null)
  const [isInsertMenuOpen, setIsInsertMenuOpen] = useState(false)
  const [insertMenuAnchor, setInsertMenuAnchor] = useState<{ x: number; y: number } | null>(null)
  const [insertTargetCoords, setInsertTargetCoords] = useState<Point3D | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [dragAxisLock, setDragAxisLock] = useState<'x' | 'y' | 'z' | null>(null)
  const dragPlaneRef = useRef<Plane | null>(null)
  const dragStartPointRef = useRef<Vector3 | null>(null)
  const dragStartOffsetRef = useRef<OffsetVector | null>(null)
  const [isShortcutsOpen, setIsShortcutsOpen] = useState(false)
  const [isPickMenuOpen, setIsPickMenuOpen] = useState(false)
  const [pickMenuAnchor, setPickMenuAnchor] = useState<{ x: number; y: number } | null>(null)
  const [pickCandidates, setPickCandidates] = useState<PickCandidate[]>([])
  const [pickCandidateTypes, setPickCandidateTypes] = useState<Record<string, string>>({})
  const pickTypeRequestRef = useRef(0)
  const { tree, setIfcTree, resetTree, addCustomNode, removeNode } = useObjectTree()
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [metadataEntries, setMetadataEntries] = useState<MetadataEntry[]>([])
  const [furnitureEntries, setFurnitureEntries] = useState<FurnitureItem[]>([])
  const [historyEntries, setHistoryEntries] = useState<HistoryEntry[]>([])
  const [viewFilters, setViewFilters] = useState<Record<string, boolean>>(() => {
    return Object.fromEntries(IFC_VIEW_FILTERS.map((filter) => [filter.key, false]))
  })
  const [isHydrated, setIsHydrated] = useState(false)
  const furnitureRestoredRef = useRef(false)
  const offsetsRestoredRef = useRef<number | null>(null)
  const [activeModelId, setActiveModelId] = useState<number | null>(null)
  const roomNumbersRef = useRef<Map<number, string>>(new Map())
  const suppressMetadataNotifyRef = useRef(false)
  const suppressFurnitureNotifyRef = useRef(false)
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
    handlePick,
    selectById,
    selectCustomCube,
    clearIfcHighlight,
    getElementWorldPosition,
    moveSelectedTo,
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
    applyVisibilityFilter
  } = useSelectionOffsets(viewerRef)

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
  const activeFilterDefs = useMemo(
    () => IFC_VIEW_FILTERS.filter((filter) => viewFilters[filter.key]),
    [viewFilters]
  )
  const filterOptions = useMemo(
    () =>
      IFC_VIEW_FILTERS.map((filter) => ({
        key: filter.key,
        label: filter.label,
        active: Boolean(viewFilters[filter.key])
      })),
    [viewFilters]
  )
  const pickMenuItems = useMemo(
    () =>
      pickCandidates.map((candidate) => ({
        id: `${candidate.modelID}:${candidate.expressID}`,
        label: `#${candidate.expressID}`,
        meta: pickCandidateTypes[`${candidate.modelID}:${candidate.expressID}`]
      })),
    [pickCandidateTypes, pickCandidates]
  )
  const pickMenuLookup = useMemo(
    () => new Map(pickCandidates.map((candidate) => [`${candidate.modelID}:${candidate.expressID}`, candidate])),
    [pickCandidates]
  )
  const showSidePanel = showTree || showProperties

  const toggleFilter = useCallback((key: string) => {
    setViewFilters((prev) => ({
      ...prev,
      [key]: !prev[key]
    }))
  }, [])

  const resetFilters = useCallback(() => {
    setViewFilters(Object.fromEntries(IFC_VIEW_FILTERS.map((filter) => [filter.key, false])))
  }, [])

  const closePickMenu = useCallback(() => {
    setIsPickMenuOpen(false)
    setPickMenuAnchor(null)
    setPickCandidates([])
    setPickCandidateTypes({})
  }, [])

  const handlePickMenuSelect = useCallback(
    (candidateId: string) => {
      const candidate = pickMenuLookup.get(candidateId)
      closePickMenu()
      if (!candidate) return
      if (candidate.kind === 'custom') {
        selectCustomCube(candidate.expressID)
      } else {
        selectById(candidate.modelID, candidate.expressID)
      }
    },
    [closePickMenu, pickMenuLookup, selectById, selectCustomCube]
  )

  useEffect(() => {
    if (!isPickMenuOpen || pickCandidates.length === 0) {
      setPickCandidateTypes({})
      return
    }

    const viewer = viewerRef.current
    if (!viewer) {
      setPickCandidateTypes({})
      return
    }

    const token = ++pickTypeRequestRef.current
    const fallbackEntries = pickCandidates.map((candidate) => [
      `${candidate.modelID}:${candidate.expressID}`,
      candidate.kind === 'custom' ? 'custom cube' : 'ifc element'
    ])
    setPickCandidateTypes(Object.fromEntries(fallbackEntries))
    const resolveTypes = async () => {
      const entries = await Promise.all(
        pickCandidates.map(async (candidate) => {
          const key = `${candidate.modelID}:${candidate.expressID}`
          if (candidate.kind === 'custom') {
            return [key, 'custom cube'] as const
          }
          try {
            const manager = viewer.IFC?.loader?.ifcManager as
              | { getIfcType?: (modelID: number, id: number) => string | undefined }
              | undefined
            const directType = manager?.getIfcType?.(candidate.modelID, candidate.expressID)
            if (directType) {
              return [key, directType.toLowerCase()] as const
            }

            const props = await viewer.IFC.getProperties(candidate.modelID, candidate.expressID, false, false)
            const rawType =
              typeof props?.ifcClass === 'string'
                ? props.ifcClass
                : typeof props?.type === 'string'
                  ? props.type
                  : null
            return [key, rawType ? rawType.toLowerCase() : 'ifc element'] as const
          } catch (err) {
            console.warn('Failed to resolve IFC type for pick candidate', candidate.expressID, err)
            return [key, 'ifc element'] as const
          }
        })
      )
      if (pickTypeRequestRef.current !== token) return
      setPickCandidateTypes(Object.fromEntries(entries))
    }

    resolveTypes()
  }, [isPickMenuOpen, pickCandidates, viewerRef])

  const getTypeIds = useCallback(
    async (modelID: number, typeId: number): Promise<number[]> => {
      const viewer = viewerRef.current
      if (!viewer) return []
      let modelCache = filterCacheRef.current.get(modelID)
      if (!modelCache) {
        modelCache = new Map()
        filterCacheRef.current.set(modelID, modelCache)
      }
      const cached = modelCache.get(typeId)
      if (cached) return cached
      const manager = viewer.IFC.loader.ifcManager as {
        getAllItemsOfType?: (id: number, type: number, verbose?: boolean) => number[] | Promise<number[]>
      }
      const getter = manager.getAllItemsOfType ?? viewer.IFC.getAllItemsOfType?.bind(viewer.IFC)
      if (!getter) {
        return []
      }
      const ids = await Promise.resolve(getter(modelID, typeId, false))
      const safeIds = Array.isArray(ids) ? ids.filter((value) => typeof value === 'number') : []
      modelCache.set(typeId, safeIds)
      return safeIds
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

  const upsertFurnitureItem = useCallback((nextItem: FurnitureItem) => {
    setFurnitureEntries((prev) => {
      const index = prev.findIndex((item) => item.id === nextItem.id)
      if (index === -1) {
        return [...prev, nextItem]
      }
      const next = prev.slice()
      next[index] = {
        ...prev[index],
        ...nextItem,
        position: nextItem.position,
        rotation: nextItem.rotation ?? prev[index].rotation,
        scale: nextItem.scale ?? prev[index].scale,
        roomNumber: nextItem.roomNumber ?? prev[index].roomNumber
      }
      return next
    })
  }, [])

  const registerCubeFurniture = useCallback(
    (info: { expressID: number; position: Point3D }, roomNumber?: string | null) => {
      setCustomCubeRoomNumber(info.expressID, roomNumber)
      upsertFurnitureItem({
        id: `${CUBE_ITEM_PREFIX}${info.expressID}`,
        model: 'cube',
        position: info.position,
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
        roomNumber: roomNumber ?? undefined
      })
    },
    [setCustomCubeRoomNumber, upsertFurnitureItem]
  )

  const syncSelectedCubePosition = useCallback(() => {
    if (!selectedElement || selectedElement.modelID !== CUSTOM_CUBE_MODEL_ID) return
    const pos = getSelectedWorldPosition()
    if (!pos) return
    upsertFurnitureItem({
      id: `${CUBE_ITEM_PREFIX}${selectedElement.expressID}`,
      model: 'cube',
      position: { x: pos.x, y: pos.y, z: pos.z },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 }
    })
  }, [getSelectedWorldPosition, selectedElement, upsertFurnitureItem])

  const syncSelectedIfcPosition = useCallback(() => {
    if (!selectedElement || selectedElement.modelID === CUSTOM_CUBE_MODEL_ID) return
    const resolved =
      getElementWorldPosition(selectedElement.modelID, selectedElement.expressID) ?? {
        x: offsetInputs.dx,
        y: offsetInputs.dy,
        z: offsetInputs.dz
      }
    upsertMetadataEntry(selectedElement.expressID, (existing) => {
      const resolvedType =
        typeof selectedElement.type === 'string' ? selectedElement.type : existing.type
      const prev = existing.position
      const isSamePosition =
        prev &&
        Math.abs(prev.x - resolved.x) < POSITION_EPSILON &&
        Math.abs(prev.y - resolved.y) < POSITION_EPSILON &&
        Math.abs(prev.z - resolved.z) < POSITION_EPSILON
      if (isSamePosition && existing.type === resolvedType) {
        return existing
      }
      return {
        ...existing,
        ifcId: selectedElement.expressID,
        type: resolvedType,
        position: resolved,
        custom: existing.custom ?? {}
      }
    })
  }, [getElementWorldPosition, offsetInputs, selectedElement, upsertMetadataEntry])

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
        suppressFurnitureNotifyRef.current = true
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
    if (furniture !== undefined) {
      const incomingFurniture = Array.isArray(furniture) ? furniture : []
      setFurnitureEntries((prev) => {
        if (prev === incomingFurniture) return prev
        suppressFurnitureNotifyRef.current = true
        return incomingFurniture
      })
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
    const timer = window.setTimeout(() => {
      onMetadataChange(metadataEntries)
    }, 500)
    return () => window.clearTimeout(timer)
  }, [isHydrated, metadataEntries, onMetadataChange])

  useEffect(() => {
    if (!isHydrated || !onFurnitureChange) return
    if (suppressFurnitureNotifyRef.current) {
      suppressFurnitureNotifyRef.current = false
      return
    }
    const timer = window.setTimeout(() => {
      onFurnitureChange(furnitureEntries)
    }, 500)
    return () => window.clearTimeout(timer)
  }, [furnitureEntries, isHydrated, onFurnitureChange])

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
    if (!showShortcuts && isShortcutsOpen) {
      setIsShortcutsOpen(false)
    }
  }, [isShortcutsOpen, showShortcuts])

  const resolveRoomNumberForNode = useCallback(
    (nodeId: string | null | undefined): string | null => {
      if (!nodeId) return null
      const roomNumbers = roomNumbersRef.current
      let currentId: string | null | undefined = nodeId
      while (currentId) {
        const node = tree.nodes[currentId]
        if (!node) break
        if (node.nodeType === 'ifc' && node.expressID !== null) {
          const roomNumber = roomNumbers.get(node.expressID)
          if (roomNumber) return roomNumber
        }
        currentId = node.parentId
      }
      return null
    },
    [tree.nodes]
  )

  const findSpaceNodeIdByRoomNumber = useCallback(
    (roomNumber: string | null | undefined): string | null => {
      if (!roomNumber) return null
      const roomNumbers = roomNumbersRef.current
      for (const node of Object.values(tree.nodes)) {
        if (node.nodeType !== 'ifc') continue
        if (node.expressID === null) continue
        if (node.type.toUpperCase() !== 'IFCSPACE') continue
        const spaceRoomNumber = roomNumbers.get(node.expressID)
        if (spaceRoomNumber === roomNumber) {
          return node.id
        }
      }
      return null
    },
    [tree.nodes]
  )

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
      if (!entry.position) return
      applyIfcElementOffset(activeModelId, entry.ifcId, {
        dx: entry.position.x,
        dy: entry.position.y,
        dz: entry.position.z
      })
    })
    offsetsRestoredRef.current = activeModelId
  }, [activeModelId, applyIfcElementOffset, isHydrated, metadataEntries])

  useEffect(() => {
    if (activeModelId === null) {
      return
    }
    let cancelled = false
    const applyFilters = async () => {
      if (activeFilterDefs.length === 0) {
        applyVisibilityFilter(activeModelId, null)
        if (deletedIfcIds.size > 0) {
          deletedIfcIds.forEach((id) => hideIfcElement(activeModelId, id))
        }
        return
      }
      const buckets = await Promise.all(
        activeFilterDefs.map((filter) => getTypeIds(activeModelId, filter.typeId))
      )
      if (cancelled) return
      const merged = Array.from(new Set(buckets.flat()))
      const filtered = deletedIfcIds.size
        ? merged.filter((id) => !deletedIfcIds.has(id))
        : merged
      applyVisibilityFilter(activeModelId, filtered)
    }
    void applyFilters()
    return () => {
      cancelled = true
    }
  }, [activeFilterDefs, activeModelId, applyVisibilityFilter, deletedIfcIds, getTypeIds, hideIfcElement])

  const updateHoverCoords = useCallback(() => {
    // Cast a ray to show world coordinates under cursor
    const viewer = viewerRef.current
    if (!viewer) return

    const hit = viewer.context.castRayIfc()
    if (hit?.point) {
      setHoverCoords({
        x: hit.point.x,
        y: hit.point.y,
        z: hit.point.z
      })
    } else {
      setHoverCoords(null)
    }
  }, [])

  const spawnUnitCube = useCallback(() => {
    const target = insertTargetCoords || hoverCoords || null
    const info = spawnCube(target, { focus: true })
    if (!info) return
    const roomNumber = resolveRoomNumberForNode(selectedNodeId)
    registerCubeFurniture(info, roomNumber)
    addCustomNode({
      modelID: CUSTOM_CUBE_MODEL_ID,
      expressID: info.expressID,
      label: `Cube #${info.expressID}`,
      type: 'CUBE',
      parentId: selectedNodeId
    })
  }, [
    addCustomNode,
    hoverCoords,
    insertTargetCoords,
    registerCubeFurniture,
    resolveRoomNumberForNode,
    selectedNodeId,
    spawnCube
  ])

  const spawnUploadedModelAt = useCallback(
    async (uploadFile: File) => {
      const target = insertTargetCoords || hoverCoords || { x: 0, y: 0, z: 0 }
      await spawnUploadedModel(uploadFile, target, { focus: true })
    },
    [hoverCoords, insertTargetCoords, spawnUploadedModel]
  )

  const rebuildTreeForModel = useCallback(
    async (modelID: number, loadToken: number) => {
      const viewer = viewerRef.current
      if (!viewer) return
      try {
        const spatial = await viewer.IFC.getSpatialStructure(modelID)
        if (loadTokenRef.current !== loadToken) return
        const tree = buildIfcTree(spatial, modelID)
        if (loadTokenRef.current !== loadToken) return
        let groupedTree = tree
        roomNumbersRef.current = new Map()
        // Optional grouping: if room numbers exist in Psets, move elements under the matching IfcSpace.
        try {
          const roomNumbers = await buildRoomNumberMap(viewer, tree, modelID)
          if (loadTokenRef.current !== loadToken) return
          roomNumbersRef.current = roomNumbers
          groupedTree = groupIfcTreeByRoomNumber(tree, roomNumbers)
        } catch (err) {
          console.warn('Failed to group storey nodes by room number', err)
        }
        setIfcTree(groupedTree, modelID)
        setSelectedNodeId(groupedTree.roots[0] ?? null)
      } catch (err) {
        if (loadTokenRef.current !== loadToken) return
        console.error('Failed to build IFC tree', err)
        resetTree()
        setSelectedNodeId(null)
      }
    },
    [resetTree, setIfcTree]
  )

  const collectDescendantExpressIds = useCallback(
    (nodeId: string) => {
      const root = tree.nodes[nodeId]
      if (!root) return []
      const stack = [...root.children]
      const ids = new Set<number>()
      while (stack.length > 0) {
        const currentId = stack.pop()
        if (!currentId) continue
        const node = tree.nodes[currentId]
        if (!node) continue
        if (node.nodeType === 'ifc' && node.expressID !== null) {
          ids.add(node.expressID)
        }
        if (node.children.length > 0) {
          stack.push(...node.children)
        }
      }
      return Array.from(ids)
    },
    [tree.nodes]
  )

  const handleTreeSelect = useCallback(
    async (nodeId: string) => {
      setSelectedNodeId(nodeId)
      const node = tree.nodes[nodeId]
      if (!node) return
      if (node.nodeType === 'ifc') {
        if (node.expressID !== null) {
          const descendantIds = collectDescendantExpressIds(nodeId)
          await selectById(node.modelID, node.expressID, { highlightIds: descendantIds })
          return
        }
        clearIfcHighlight()
        return
      }
      clearIfcHighlight()
      if (
        node.nodeType === 'custom' &&
        node.modelID === CUSTOM_CUBE_MODEL_ID &&
        node.expressID !== null
      ) {
        selectCustomCube(node.expressID)
      }
    },
    [clearIfcHighlight, collectDescendantExpressIds, selectById, selectCustomCube, tree.nodes]
  )

  const handleTreeAddCube = useCallback(
    async (nodeId: string) => {
      const node = tree.nodes[nodeId]
      let target: Point3D | null = null

      if (node?.nodeType === 'ifc' && node.expressID !== null) {
        // Mimic "select parent": select the node to resolve a stable world-space target.
        const descendantIds = collectDescendantExpressIds(nodeId)
        target = await selectById(node.modelID, node.expressID, {
          highlightIds: descendantIds
        })
      }

      // Spawn at the same coordinates as the parent selection (fallback to origin).
      const resolvedTarget = target ?? { x: 0, y: 0, z: 0 }
      const info = spawnCube(resolvedTarget, { focus: true })
      if (!info) return
      const roomNumber = resolveRoomNumberForNode(nodeId)
      registerCubeFurniture(info, roomNumber)
      const newNodeId = addCustomNode({
        modelID: CUSTOM_CUBE_MODEL_ID,
        expressID: info.expressID,
        label: `Cube #${info.expressID}`,
        type: 'CUBE',
        parentId: nodeId
      })
      setSelectedNodeId(newNodeId)
      selectCustomCube(info.expressID)
    },
    [
      addCustomNode,
      collectDescendantExpressIds,
      registerCubeFurniture,
      resolveRoomNumberForNode,
      selectById,
      selectCustomCube,
      spawnCube,
      tree.nodes
    ]
  )

  const handleTreeUploadModel = useCallback((nodeId: string) => {
    pendingTreeUploadRef.current = nodeId
    treeUploadInputRef.current?.click()
  }, [])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const handlePointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return
      handlePick()
    }

    container.addEventListener('pointerdown', handlePointerDown)
    return () => {
      container.removeEventListener('pointerdown', handlePointerDown)
    }
  }, [handlePick])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const handlePointerMove = (event: PointerEvent) => {
      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect()
        lastPointerPosRef.current = {
          x: Math.max(0, Math.min(event.clientX - rect.left, rect.width)),
          y: Math.max(0, Math.min(event.clientY - rect.top, rect.height))
        }
      }
      if (isDragging) {
        // Dragging: project cursor onto the active drag plane and apply axis lock.
        const viewer = viewerRef.current
        const plane = dragPlaneRef.current
        if (viewer && plane && containerRef.current) {
          const rect = containerRef.current.getBoundingClientRect()
          const ndc = new Vector3(
            (event.clientX - rect.left) / rect.width * 2 - 1,
            -(event.clientY - rect.top) / rect.height * 2 + 1,
            0.5
          )
          const raycaster = new Raycaster()
          raycaster.setFromCamera(ndc, viewer.context.getCamera())
          const hitPoint = new Vector3()
          const ok = raycaster.ray.intersectPlane(plane, hitPoint)
          if (ok && dragStartPointRef.current && dragStartOffsetRef.current) {
            const delta = hitPoint.clone().sub(dragStartPointRef.current)
            if (dragAxisLock === 'x') {
              delta.y = 0
              delta.z = 0
            } else if (dragAxisLock === 'y') {
              delta.x = 0
              delta.z = 0
            } else if (dragAxisLock === 'z') {
              delta.x = 0
              delta.y = 0
            }
            const newOffset = {
              dx: dragStartOffsetRef.current.dx + delta.x,
              dy: dragStartOffsetRef.current.dy + delta.y,
              dz: dragStartOffsetRef.current.dz + delta.z
            }
            moveSelectedTo(newOffset)
          }
        }
      } else {
        updateHoverCoords()
      }
    }

    container.addEventListener('pointermove', handlePointerMove)
    return () => {
      container.removeEventListener('pointermove', handlePointerMove)
    }
  }, [dragAxisLock, isDragging, moveSelectedTo, updateHoverCoords])

  useEffect(() => {
    if (!selectedElement) {
      setSelectedNodeId(null)
      return
    }
    const match = Object.values(tree.nodes).find(
      (node) =>
        node.modelID === selectedElement.modelID &&
        node.expressID === selectedElement.expressID
    )
    setSelectedNodeId(match?.id ?? null)
  }, [selectedElement, tree.nodes])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (showShortcuts && (event.key === '?' || event.key.toLowerCase() === 'h')) {
        setIsShortcutsOpen((prev) => !prev)
        return
      }
      if (event.key.toLowerCase() === 'a') {
        // Pop insert menu near cursor and cache the casted target point
        const container = containerRef.current
        if (container) {
          const rect = container.getBoundingClientRect()
          const x = Math.max(0, Math.min(lastPointerPosRef.current.x, rect.width))
          const y = Math.max(0, Math.min(lastPointerPosRef.current.y, rect.height))
          setInsertMenuAnchor({
            x: x + 12,
            y: y - 4
          })
        } else {
          setInsertMenuAnchor({ x: 16, y: 16 })
        }
        const viewer = viewerRef.current
        const hit = viewer?.context.castRayIfc()
        const point =
          hit?.point ??
          hoverCoords ?? {
            x: 0,
            y: 0,
            z: 0
          }
        setInsertTargetCoords(point ? { x: point.x, y: point.y, z: point.z } : null)
        setIsInsertMenuOpen(true)
      }
      if (event.key.toLowerCase() === 'k') {
        const container = containerRef.current
        if (!container) return
        const rect = container.getBoundingClientRect()
        const clientX = rect.left + lastPointerPosRef.current.x
        const clientY = rect.top + lastPointerPosRef.current.y
        const candidates = pickCandidatesAt(clientX, clientY, container, 0.5)
        if (candidates.length === 0) {
          closePickMenu()
          return
        }
        if (candidates.length === 1) {
          closePickMenu()
          const only = candidates[0]
          if (only.kind === 'custom') {
            selectCustomCube(only.expressID)
          } else {
            selectById(only.modelID, only.expressID)
          }
          return
        }

        setPickCandidates(candidates)
        setIsPickMenuOpen(true)
        setPickMenuAnchor({
          x: Math.max(0, Math.min(lastPointerPosRef.current.x + 12, rect.width - 12)),
          y: Math.max(0, Math.min(lastPointerPosRef.current.y + 12, rect.height - 12))
        })
      }
      if (event.key.toLowerCase() === 'g') {
        if (!selectedElement) return
        const viewer = viewerRef.current
        const currentPos = getSelectedWorldPosition()
        if (!viewer || !currentPos) return
        // Default move mode: drag on a plane facing the camera.
        const camera = viewer.context.getCamera()
        const normal = new Vector3()
        camera.getWorldDirection(normal)
        let startPoint = currentPos
        if (selectedElement.modelID !== CUSTOM_CUBE_MODEL_ID) {
          const hit = viewer.context.castRayIfc()
          if (hit?.point) {
            startPoint = hit.point
          }
        }
        const plane = new Plane().setFromNormalAndCoplanarPoint(normal, startPoint)
        dragPlaneRef.current = plane
        dragStartPointRef.current = startPoint.clone()
        dragStartOffsetRef.current = {
          dx: offsetInputs.dx,
          dy: offsetInputs.dy,
          dz: offsetInputs.dz
        }
        setIsDragging(true)
        setDragAxisLock(null)
      }
      if (isDragging && event.key.toLowerCase() === 'f') {
        const viewer = viewerRef.current
        const currentPos = getSelectedWorldPosition()
        if (!viewer || !currentPos) return
        // Floor move mode: lock movement to the horizontal plane (Y constant).
        const normal = new Vector3(0, 1, 0)
        const plane = new Plane().setFromNormalAndCoplanarPoint(normal, currentPos)
        let startPoint = currentPos.clone()
        const container = containerRef.current
        if (container) {
          const rect = container.getBoundingClientRect()
          const ndc = new Vector3(
            (lastPointerPosRef.current.x / rect.width) * 2 - 1,
            -(lastPointerPosRef.current.y / rect.height) * 2 + 1,
            0.5
          )
          const raycaster = new Raycaster()
          raycaster.setFromCamera(ndc, viewer.context.getCamera())
          const hitPoint = new Vector3()
          const hit = raycaster.ray.intersectPlane(plane, hitPoint)
          if (hit) {
            startPoint = hitPoint
          }
        }
        dragPlaneRef.current = plane
        dragStartPointRef.current = startPoint.clone()
        dragStartOffsetRef.current = {
          dx: offsetInputs.dx,
          dy: offsetInputs.dy,
          dz: offsetInputs.dz
        }
        setDragAxisLock(null)
      }
      if (isDragging && ['x', 'y', 'z'].includes(event.key.toLowerCase())) {
        const key = event.key.toLowerCase() as 'x' | 'y' | 'z'
        setDragAxisLock(key)
      }
      if (event.key === 'Escape') {
        setIsInsertMenuOpen(false)
        setInsertMenuAnchor(null)
        setInsertTargetCoords(null)
        setIsDragging(false)
        setDragAxisLock(null)
        dragPlaneRef.current = null
        dragStartPointRef.current = null
        dragStartOffsetRef.current = null
        setIsShortcutsOpen(false)
        closePickMenu()
      }
    }

    const handlePointerUp = () => {
      const wasDragging = isDragging || dragStartOffsetRef.current !== null
      if (wasDragging) {
        syncSelectedCubePosition()
        syncSelectedIfcPosition()
        if (selectedElement && selectedElement.modelID !== CUSTOM_CUBE_MODEL_ID) {
          pushHistoryEntry(selectedElement.expressID, 'Position updated')
        }
      }
      setIsDragging(false)
      setDragAxisLock(null)
      dragPlaneRef.current = null
      dragStartPointRef.current = null
      dragStartOffsetRef.current = null
    }

    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('pointerup', handlePointerUp)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('pointerup', handlePointerUp)
    }
  }, [
    closePickMenu,
    getSelectedWorldPosition,
    hoverCoords,
    isDragging,
    offsetInputs,
    pickCandidatesAt,
    selectedElement,
    pushHistoryEntry,
    selectById,
    selectCustomCube,
    showShortcuts,
    syncSelectedCubePosition,
    syncSelectedIfcPosition
  ])

  const loadModel = useCallback(
    async (loader: Loader, message: string) => {
      const viewer = ensureViewer()
      if (!viewer) return

      const token = ++loadTokenRef.current

      setStatus(message)
      setError(null)
      resetSelection()
      resetTree()
      setSelectedNodeId(null)
      setActiveModelId(null)
      roomNumbersRef.current = new Map()
      filterCacheRef.current.clear()
      offsetsRestoredRef.current = null
      if (lastModelIdRef.current !== null) {
        clearOffsetArtifacts(lastModelIdRef.current)
      }

      if (lastModelIdRef.current !== null) {
        viewer.IFC.removeIfcModel(lastModelIdRef.current)
        lastModelIdRef.current = null
      }

      try {
        const model = await loader(viewer)
        if (!model) {
          throw new Error('IFC model could not be loaded.')
        }

        if (loadTokenRef.current !== token) {
          if (model.modelID !== undefined) {
            viewer.IFC.removeIfcModel(model.modelID)
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
    [clearOffsetArtifacts, ensureViewer, rebuildTreeForModel, resetSelection, resetTree]
  )

  useEffect(() => {
    ensureViewer()

    return () => {
      clearOffsetArtifacts()
      if (viewerRef.current) {
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
  }, [clearOffsetArtifacts, ensureViewer, resetTree])

  useEffect(() => {
    if (!defaultModelUrl) {
      return
    }

    if (file) {
      loadModel((viewer) => viewer.IFC.loadIfc(file, true), 'Loading IFC file...')
    } else {
      loadModel(
        (viewer) => viewer.IFC.loadIfcUrl(defaultModelUrl, true),
        'Loading sample model...'
      )
    }
  }, [defaultModelUrl, file, loadModel])

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
                setIsInsertMenuOpen(false)
                setInsertMenuAnchor(null)
                setInsertTargetCoords(null)
              }}
              onUploadClick={() => uploadInputRef.current?.click()}
              onCancel={() => {
                setIsInsertMenuOpen(false)
                setInsertMenuAnchor(null)
                setInsertTargetCoords(null)
              }}
            />
            <SelectionMenu
              open={isPickMenuOpen}
              anchor={pickMenuAnchor}
              candidates={pickMenuItems}
              onSelect={handlePickMenuSelect}
              onCancel={closePickMenu}
            />
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
                  onAddCube={handleTreeAddCube}
                  onUploadModel={handleTreeUploadModel}
                  filters={filterOptions}
                  filtersDisabled={activeModelId === null}
                  hasActiveFilters={activeFilterDefs.length > 0}
                  onToggleFilter={toggleFilter}
                  onResetFilters={resetFilters}
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
          setIsInsertMenuOpen(false)
          setInsertMenuAnchor(null)
          setInsertTargetCoords(null)
        }}
      />
      <input
        type="file"
        accept=".ifc"
        style={{ display: 'none' }}
        ref={treeUploadInputRef}
        onChange={async (event) => {
          const inputFile = event.target.files?.[0]
          const parentId = pendingTreeUploadRef.current
          if (inputFile && parentId) {
            const resolvedTarget = { x: 0, y: 0, z: 0 }
            const info = await spawnUploadedModel(inputFile, resolvedTarget, { focus: true })
            if (info) {
              const newNodeId = addCustomNode({
                modelID: info.modelID,
                expressID: null,
                label: inputFile.name,
                type: 'IFC',
                parentId
              })
              setSelectedNodeId(newNodeId)
            }
          }
          pendingTreeUploadRef.current = null
          event.target.value = ''
        }}
      />
    </>
  )
}

export default IfcViewer

