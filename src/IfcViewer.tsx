import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { FrontSide, Matrix4, Plane, Raycaster, Vector2, Vector3 } from 'three'
import CameraControls from 'camera-controls'
import { IfcViewerAPI } from './viewer/IfcViewerAPICompat'
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
import {
  buildIfcTree,
  groupIfcTreeByRoomNumber,
  groupIfcTreeBySpatialContainment,
  useObjectTree
} from './hooks/useObjectTree'
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
type LoadSource =
  | { kind: 'none' }
  | { kind: 'file'; file: File }
  | { kind: 'url'; url: string }

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

const wasmRootPath = '/ifc/'
const CUBE_ITEM_PREFIX = 'cube-'
const MOVE_DELTA_CUSTOM_KEY = '__bakaMoveDeltaJson'
const ROTATE_DELTA_CUSTOM_KEY = '__bakaRotateDeltaJson'
const POSITION_EPSILON = 1e-4
const ROTATION_EPSILON = 1e-4
const ROTATE_DRAG_SENSITIVITY = 0.02
const WALK_MOVE_SPEED = 2.8
const WALK_LOOK_SENSITIVITY = 0.00125
const WALK_PITCH_LIMIT = Math.PI / 2 - 0.05
const WALK_DRAG_MOVE_PER_PIXEL = 0.02
const FREE_WHEEL_MOVE_FACTOR = 0.0067
const FREE_WHEEL_MAX_DELTA = 240
const ROOM_SELECT_Y_OFFSET = 1
const MODEL_LOAD_TIMEOUT_MS = 60_000
const IFC_LOADER_SETTINGS = {
  COORDINATE_TO_ORIGIN: true,
  USE_FAST_BOOLS: false
}
// Common property names used by authoring tools for room numbers (Pset text values).
const ROOM_NUMBER_KEYS = new Set([
  'raumnummer',
  'roomnumber'
])
const ENABLE_ROOM_NUMBER_GROUPING = false
const MAX_ROOM_NUMBER_LOOKUPS = 400
const ROOM_NUMBER_BATCH_SIZE = 20
const CONTAINMENT_RELATION_BATCH_SIZE = 20
const MAX_CONTAINMENT_RELATION_LOOKUPS = 800
const UNKNOWN_TREE_TYPE_BATCH_SIZE = 20
const MAX_UNKNOWN_TREE_TYPE_LOOKUPS = 1200
const SHORTCUTS = [
  { keys: 'M', label: 'Toggle free look / walk mode' },
  { keys: 'Arrow Keys', label: 'Move in walk mode (fixed height)' },
  { keys: 'Middle Mouse Drag (walk)', label: 'Rotate camera' },
  { keys: 'Right Mouse Drag (walk)', label: 'Move in floor plane' },
  { keys: 'A (free mode)', label: 'Open insert menu at cursor' },
  { keys: 'G', label: 'Start move mode' },
  { keys: 'R', label: 'Start rotate mode' },
  { keys: 'X / Y / Z', label: 'Lock axis while moving / rotating' },
  { keys: 'F', label: 'Move in floor plane (keep height)' },
  { keys: 'Left Click', label: 'Pick element / open overlap menu' },
  { keys: 'Esc', label: 'Cancel drag / close menus' },
  { keys: '? / H', label: 'Toggle shortcuts help' }
]

const isSameLoadSource = (left: LoadSource, right: LoadSource): boolean => {
  if (left.kind !== right.kind) return false
  if (left.kind === 'none') return true
  if (left.kind === 'file' && right.kind === 'file') return left.file === right.file
  if (left.kind === 'url' && right.kind === 'url') return left.url === right.url
  return false
}

const withTimeout = async <T,>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> => {
  let timer: number | undefined
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = window.setTimeout(() => {
      reject(new Error(`${label} timed out after ${Math.round(timeoutMs / 1000)}s`))
    }, timeoutMs)
  })

  try {
    return (await Promise.race([promise, timeoutPromise])) as T
  } finally {
    if (timer !== undefined) {
      window.clearTimeout(timer)
    }
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

type NavigationMode = 'free' | 'walk'
type WalkMoveKey = 'arrowup' | 'arrowleft' | 'arrowdown' | 'arrowright'
type RoomListEntry = { nodeId: string; label: string; roomNumber?: string | null }

const emptyWalkKeyState: Record<WalkMoveKey, boolean> = {
  arrowup: false,
  arrowleft: false,
  arrowdown: false,
  arrowright: false
}

const getWalkMoveKey = (event: KeyboardEvent): WalkMoveKey | null => {
  const key = event.key.toLowerCase()
  if (key === 'arrowup' || key === 'up' || event.code === 'ArrowUp') return 'arrowup'
  if (key === 'arrowleft' || key === 'left' || event.code === 'ArrowLeft') return 'arrowleft'
  if (key === 'arrowdown' || key === 'down' || event.code === 'ArrowDown') return 'arrowdown'
  if (key === 'arrowright' || key === 'right' || event.code === 'ArrowRight') return 'arrowright'
  return null
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

const applyNavigationControls = (viewer: IfcViewerAPI, mode: NavigationMode) => {
  const controls = viewer.context.ifcCamera.cameraControls
  if (mode === 'walk') {
    controls.mouseButtons.left = CameraControls.ACTION.NONE
    controls.mouseButtons.middle = CameraControls.ACTION.NONE
    controls.mouseButtons.right = CameraControls.ACTION.NONE
    controls.mouseButtons.wheel = CameraControls.ACTION.NONE
    return
  }

  controls.mouseButtons.left = CameraControls.ACTION.NONE
  controls.mouseButtons.middle = CameraControls.ACTION.ROTATE
  controls.mouseButtons.right = CameraControls.ACTION.TRUCK
  controls.mouseButtons.wheel = CameraControls.ACTION.NONE
}

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

const normalizeIfcTypeValue = (value: unknown): string | null => {
  if (typeof value === 'string') {
    const normalized = value.trim().toUpperCase()
    return normalized || null
  }
  if (value && typeof value === 'object' && 'value' in (value as Record<string, unknown>)) {
    return normalizeIfcTypeValue((value as { value?: unknown }).value)
  }
  return null
}

const resolveIfcTypeFromProperties = (properties: any): string | null => {
  const candidates = [
    properties?.ifcClass,
    properties?.type,
    properties?._category,
    properties?.category,
    properties?.ObjectType,
    properties?.PredefinedType
  ]
  for (const candidate of candidates) {
    const normalized = normalizeIfcTypeValue(candidate)
    if (normalized) return normalized
  }
  return null
}

const parseIfcReferenceId = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.trunc(value)
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) {
      return Math.trunc(parsed)
    }
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      const parsed = parseIfcReferenceId(entry)
      if (parsed !== null) return parsed
    }
    return null
  }
  if (!value || typeof value !== 'object') return null

  const candidate = value as Record<string, unknown>
  const keys = ['value', 'expressID', 'expressId', 'localId', 'id']
  for (const key of keys) {
    if (!(key in candidate)) continue
    const parsed = parseIfcReferenceId(candidate[key])
    if (parsed !== null) return parsed
  }
  return null
}

const resolveIfcEntityKind = (value: unknown): string | null => {
  if (!value || typeof value !== 'object') return null
  const item = value as Record<string, unknown>
  const candidates = [item.type, item.ifcClass, item._category, item.category]
  for (const candidate of candidates) {
    const normalized = normalizeIfcTypeValue(candidate)
    if (normalized) return normalized
  }
  return null
}

const resolveContainedSpaceId = (properties: any): number | null => {
  const relationCandidates = [
    properties?.ContainedInStructure,
    properties?.containedInStructure,
    properties?.IsContainedIn,
    properties?.isContainedIn
  ]
  const relations: unknown[] = []
  relationCandidates.forEach((candidate) => {
    if (candidate === undefined || candidate === null) return
    if (Array.isArray(candidate)) {
      relations.push(...candidate)
    } else {
      relations.push(candidate)
    }
  })

  for (const relation of relations) {
    const spaceId = resolveContainedSpaceIdFromRelation(relation)
    if (spaceId !== null) return spaceId
  }

  return null
}

const resolveContainedSpaceIdFromRelation = (relation: unknown): number | null => {
  if (!relation || typeof relation !== 'object') return null
  const relationObj = relation as Record<string, unknown>
  const relationType = resolveIfcEntityKind(relationObj)
  if (relationType && relationType !== 'IFCRELCONTAINEDINSPATIALSTRUCTURE') return null
  const spaceCandidate =
    relationObj.RelatingStructure ??
    relationObj.relatingStructure ??
    relationObj.RelatedStructure ??
    relationObj.relatedStructure
  return parseIfcReferenceId(spaceCandidate)
}

const collectContainedRelationIds = (properties: any): number[] => {
  const relationCandidates = [
    properties?.ContainedInStructure,
    properties?.containedInStructure,
    properties?.IsContainedIn,
    properties?.isContainedIn
  ]
  const relations: unknown[] = []
  relationCandidates.forEach((candidate) => {
    if (candidate === undefined || candidate === null) return
    if (Array.isArray(candidate)) {
      relations.push(...candidate)
    } else {
      relations.push(candidate)
    }
  })

  const relationIds: number[] = []
  for (const relation of relations) {
    const relationId = parseIfcReferenceId(relation)
    if (relationId !== null) {
      relationIds.push(relationId)
    }
  }
  return relationIds
}

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

  const lookupIds =
    expressIds.length > MAX_ROOM_NUMBER_LOOKUPS ? expressIds.slice(0, MAX_ROOM_NUMBER_LOOKUPS) : expressIds

  if (lookupIds.length < expressIds.length) {
    console.warn(
      `Room-number lookup limited to ${MAX_ROOM_NUMBER_LOOKUPS} of ${expressIds.length} elements to prevent OOM.`
    )
  }

  const results: Array<readonly [number, string] | null> = []
  for (let i = 0; i < lookupIds.length; i += ROOM_NUMBER_BATCH_SIZE) {
    const batch = lookupIds.slice(i, i + ROOM_NUMBER_BATCH_SIZE)
    const batchResults = await Promise.all(
      batch.map(async (expressID) => {
        try {
          // Recursive relation traversal can blow memory on large IFC graphs.
          // For room grouping we only need direct Pset access.
          const properties = await viewer.IFC.getProperties(modelID, expressID, false, true)
          const roomNumber = extractRoomNumber(properties)
          return roomNumber ? ([expressID, roomNumber] as const) : null
        } catch (err) {
          console.warn('Failed to read room number for element', expressID, err)
          return null
        }
      })
    )
    results.push(...batchResults)
  }

  const map = new Map<number, string>()
  results.forEach((entry) => {
    if (!entry) return
    map.set(entry[0], entry[1])
  })
  return map
}

const IFC_SPATIAL_TYPES = new Set([
  'IFCPROJECT',
  'IFCSITE',
  'IFCBUILDING',
  'IFCBUILDINGSTOREY',
  'IFCSPACE'
])

const collectContainmentCandidateIds = (tree: ObjectTree): number[] => {
  const ids = new Set<number>()

  // Prefer descendants under storeys: these are the elements that can be re-parented to spaces.
  const stack: string[] = []
  Object.values(tree.nodes).forEach((node) => {
    if (node.nodeType !== 'ifc') return
    if (node.type.toUpperCase() !== 'IFCBUILDINGSTOREY') return
    stack.push(...node.children)
  })

  const visited = new Set<string>()
  while (stack.length > 0) {
    const nodeId = stack.pop()
    if (!nodeId || visited.has(nodeId)) continue
    visited.add(nodeId)

    const node = tree.nodes[nodeId]
    if (!node) continue
    if (node.children.length > 0) {
      stack.push(...node.children)
    }
    if (node.nodeType !== 'ifc' || node.expressID === null) continue

    const type = node.type.toUpperCase()
    if (IFC_SPATIAL_TYPES.has(type) || type.startsWith('IFCREL')) continue
    ids.add(node.expressID)
  }

  // Fallback for atypical hierarchies where storey roots are missing.
  if (ids.size === 0) {
    Object.values(tree.nodes).forEach((node) => {
      if (node.nodeType !== 'ifc' || node.expressID === null) return
      const type = node.type.toUpperCase()
      if (IFC_SPATIAL_TYPES.has(type) || type.startsWith('IFCREL')) return
      const parent = node.parentId ? tree.nodes[node.parentId] : null
      const parentType = parent?.type?.toUpperCase?.() ?? ''
      if (parentType === 'IFCBUILDINGSTOREY' || parentType === 'IFCSPACE' || parentType === 'UNKNOWN') {
        ids.add(node.expressID)
      }
    })
  }
  return Array.from(ids)
}

const resolveSpaceFromRelationId = async (
  viewer: IfcViewerAPI,
  modelID: number,
  relationExpressId: number
): Promise<number | null> => {
  try {
    const relationProperties = await viewer.IFC.getProperties(modelID, relationExpressId, false, false)
    if (!relationProperties) return null
    const spaceFromRelation = resolveContainedSpaceIdFromRelation(relationProperties)
    if (spaceFromRelation !== null) {
      return spaceFromRelation
    }
    return resolveContainedSpaceId(relationProperties)
  } catch {
    return null
  }
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
      const resolvedMoveDelta =
        entry.moveDelta &&
        Number.isFinite(entry.moveDelta.x) &&
        Number.isFinite(entry.moveDelta.y) &&
        Number.isFinite(entry.moveDelta.z)
          ? {
              x: Number(entry.moveDelta.x),
              y: Number(entry.moveDelta.y),
              z: Number(entry.moveDelta.z)
            }
          : undefined
      const resolvedRotation =
        entry.rotation &&
        Number.isFinite(entry.rotation.x) &&
        Number.isFinite(entry.rotation.y) &&
        Number.isFinite(entry.rotation.z)
          ? {
              x: Number(entry.rotation.x),
              y: Number(entry.rotation.y),
              z: Number(entry.rotation.z)
            }
          : undefined
      const resolvedRotateDelta =
        entry.rotateDelta &&
        Number.isFinite(entry.rotateDelta.x) &&
        Number.isFinite(entry.rotateDelta.y) &&
        Number.isFinite(entry.rotateDelta.z)
          ? {
              x: Number(entry.rotateDelta.x),
              y: Number(entry.rotateDelta.y),
              z: Number(entry.rotateDelta.z)
            }
          : undefined
      return {
        ...entry,
        type: resolvedType,
        custom: sanitizedCustom,
        moveDelta: resolvedMoveDelta,
        rotation: resolvedRotation,
        rotateDelta: resolvedRotateDelta
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
  const treeUploadInputRef = useRef<HTMLInputElement | null>(null)
  const pendingTreeUploadRef = useRef<string | null>(null)
  // Pointer bookkeeping so the insert menu knows where to appear
  const lastPointerPosRef = useRef<{ x: number; y: number }>({ x: 16, y: 16 })
  // Remember the last loaded IFC model id for cleanup
  const lastModelIdRef = useRef<number | null>(null)
  const loadTokenRef = useRef(0)
  const [status, setStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const lastLoadSourceRef = useRef<LoadSource>({ kind: 'none' })
  const [navigationMode, setNavigationMode] = useState<NavigationMode>('free')
  const [hoverCoords, setHoverCoords] = useState<Point3D | null>(null)
  const [isInsertMenuOpen, setIsInsertMenuOpen] = useState(false)
  const [insertMenuAnchor, setInsertMenuAnchor] = useState<{ x: number; y: number } | null>(null)
  const [insertTargetCoords, setInsertTargetCoords] = useState<Point3D | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [dragAxisLock, setDragAxisLock] = useState<'x' | 'y' | 'z' | null>(null)
  const dragPlaneRef = useRef<Plane | null>(null)
  const dragStartPointRef = useRef<Vector3 | null>(null)
  const dragStartOffsetRef = useRef<OffsetVector | null>(null)
  const [isRotating, setIsRotating] = useState(false)
  const [rotateAxisLock, setRotateAxisLock] = useState<'x' | 'y' | 'z' | null>(null)
  const rotateStartPointerRef = useRef<{ x: number; y: number } | null>(null)
  const rotateStartValueRef = useRef<Point3D | null>(null)
  const rotateCurrentValueRef = useRef<Point3D | null>(null)
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
  const [isHydrated, setIsHydrated] = useState(false)
  const furnitureRestoredRef = useRef(false)
  const offsetsRestoredRef = useRef<number | null>(null)
  const [activeModelId, setActiveModelId] = useState<number | null>(null)
  const roomNumbersRef = useRef<Map<number, string>>(new Map())
  const suppressMetadataNotifyRef = useRef(false)
  const suppressFurnitureNotifyRef = useRef(false)
  const suppressHistoryNotifyRef = useRef(false)
  const walkKeyStateRef = useRef<Record<WalkMoveKey, boolean>>({ ...emptyWalkKeyState })
  const walkHeadingRef = useRef<Vector3>(new Vector3(0, 0, -1))
  const walkFrameRef = useRef<number | null>(null)
  const walkLastTimestampRef = useRef<number | null>(null)
  const walkMoveActiveRef = useRef(false)
  const walkLookActiveRef = useRef(false)
  const walkLookPointerIdRef = useRef<number | null>(null)
  const walkLookLastPointerRef = useRef<{ x: number; y: number } | null>(null)
  const walkDragActiveRef = useRef(false)
  const walkDragPointerIdRef = useRef<number | null>(null)
  const walkDragLastPointerRef = useRef<{ x: number; y: number } | null>(null)

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
    return Object.values(tree.nodes)
      .filter(
        (node) => node.nodeType === 'ifc' && node.expressID !== null && node.type.toUpperCase() === 'IFCSPACE'
      )
      .map((node) => ({
        nodeId: node.id,
        label: node.label,
        roomNumber: roomNumbers.get(node.expressID!) ?? null
      }))
      .sort((left, right) => {
        const leftKey = left.roomNumber?.trim() || left.label
        const rightKey = right.roomNumber?.trim() || right.label
        return leftKey.localeCompare(rightKey, undefined, { numeric: true, sensitivity: 'base' })
      })
  }, [tree.nodes])
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
  const isWalkMode = navigationMode === 'walk'
  const navigationModeRef = useRef<NavigationMode>(navigationMode)

  const toggleNavigationMode = useCallback(() => {
    setNavigationMode((prev) => (prev === 'free' ? 'walk' : 'free'))
  }, [])

  useEffect(() => {
    navigationModeRef.current = navigationMode
  }, [navigationMode])

  const setWalkOverlaySuppressed = useCallback((_suppressed: boolean) => {
    // Intentionally no-op for debugging: avoid any custom overlay movement logic.
  }, [])

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

  const stopWalkMovementLoop = useCallback(() => {
    if (walkFrameRef.current !== null) {
      cancelAnimationFrame(walkFrameRef.current)
      walkFrameRef.current = null
    }
    walkLastTimestampRef.current = null
    walkKeyStateRef.current = { ...emptyWalkKeyState }
    walkHeadingRef.current.set(0, 0, -1)
    walkMoveActiveRef.current = false
    walkLookActiveRef.current = false
    walkLookPointerIdRef.current = null
    walkLookLastPointerRef.current = null
    walkDragActiveRef.current = false
    walkDragPointerIdRef.current = null
    walkDragLastPointerRef.current = null
    setWalkOverlaySuppressed(false)
  }, [setWalkOverlaySuppressed])

  const updateWalkLookByDelta = useCallback((deltaX: number, deltaY: number): boolean => {
    const viewer = viewerRef.current
    const controls = viewer?.context?.ifcCamera?.cameraControls as
      | {
          getPosition?: (out: Vector3) => void
          getTarget?: (out: Vector3) => void
          setLookAt?: (
            positionX: number,
            positionY: number,
            positionZ: number,
            targetX: number,
            targetY: number,
            targetZ: number,
            enableTransition?: boolean
          ) => void
        }
      | undefined
    if (!controls?.getPosition || !controls?.getTarget || !controls?.setLookAt) return false

    const position = new Vector3()
    const target = new Vector3()
    controls.getPosition(position)
    controls.getTarget(target)

    const direction = target.sub(position)
    if (direction.lengthSq() <= 1e-8) {
      direction.copy(walkHeadingRef.current)
      if (direction.lengthSq() <= 1e-8) {
        direction.set(0, 0, -1)
      }
    }
    direction.normalize()

    const currentPitch = Math.asin(Math.max(-1, Math.min(1, direction.y)))
    const currentYaw = Math.atan2(direction.x, direction.z)
    const nextYaw = currentYaw - deltaX * WALK_LOOK_SENSITIVITY
    const nextPitch = Math.max(
      -WALK_PITCH_LIMIT,
      Math.min(WALK_PITCH_LIMIT, currentPitch - deltaY * WALK_LOOK_SENSITIVITY)
    )
    const cosPitch = Math.cos(nextPitch)
    const nextDirection = new Vector3(
      Math.sin(nextYaw) * cosPitch,
      Math.sin(nextPitch),
      Math.cos(nextYaw) * cosPitch
    ).normalize()

    const horizontalDirection = new Vector3(nextDirection.x, 0, nextDirection.z)
    if (horizontalDirection.lengthSq() > 1e-8) {
      horizontalDirection.normalize()
      walkHeadingRef.current.copy(horizontalDirection)
    }

    const nextTarget = position.clone().add(nextDirection)
    controls.setLookAt(
      position.x,
      position.y,
      position.z,
      nextTarget.x,
      nextTarget.y,
      nextTarget.z,
      false
    )
    return true
  }, [])

  const closePickMenu = useCallback(() => {
    setIsPickMenuOpen(false)
    setPickMenuAnchor(null)
    setPickCandidates([])
    setPickCandidateTypes({})
  }, [])

  const teleportCameraToPoint = useCallback((point: Point3D | null) => {
    if (!point) return false
    const viewer = viewerRef.current
    const controls = viewer?.context?.ifcCamera?.cameraControls as
      | {
          getPosition?: (out: Vector3) => void
          getTarget?: (out: Vector3) => void
          setLookAt?: (
            positionX: number,
            positionY: number,
            positionZ: number,
            targetX: number,
            targetY: number,
            targetZ: number,
            enableTransition?: boolean
          ) => void
        }
      | undefined
    if (!controls?.getPosition || !controls?.getTarget || !controls?.setLookAt) return false

    const currentPosition = new Vector3()
    const currentTarget = new Vector3()
    controls.getPosition(currentPosition)
    controls.getTarget(currentTarget)

    const nextTarget = new Vector3(point.x, point.y, point.z)
    const translation = nextTarget.clone().sub(currentTarget)
    currentPosition.add(translation)

    controls.setLookAt(
      currentPosition.x,
      currentPosition.y,
      currentPosition.z,
      nextTarget.x,
      nextTarget.y,
      nextTarget.z,
      false
    )
    return true
  }, [])

  const moveCameraToPoint = useCallback((point: Point3D | null) => {
    if (!point) return false
    const viewer = viewerRef.current
    const controls = viewer?.context?.ifcCamera?.cameraControls as
      | {
          getPosition?: (out: Vector3) => void
          getTarget?: (out: Vector3) => void
          setPosition?: (x: number, y: number, z: number, enableTransition?: boolean) => void
          setTarget?: (x: number, y: number, z: number, enableTransition?: boolean) => void
          setLookAt?: (
            positionX: number,
            positionY: number,
            positionZ: number,
            targetX: number,
            targetY: number,
            targetZ: number,
            enableTransition?: boolean
          ) => void
        }
      | undefined
    if (!controls) return false

    if (typeof controls.getPosition === 'function' && typeof controls.getTarget === 'function') {
      const currentPosition = new Vector3()
      const currentTarget = new Vector3()
      controls.getPosition(currentPosition)
      controls.getTarget(currentTarget)

      const viewDirection = currentTarget.sub(currentPosition)
      if (viewDirection.lengthSq() <= 1e-8) {
        viewDirection.set(0, 0, -1)
      }

      const nextPosition = new Vector3(point.x, point.y, point.z)
      const nextTarget = nextPosition.clone().add(viewDirection)

      if (typeof controls.setLookAt === 'function') {
        controls.setLookAt(
          nextPosition.x,
          nextPosition.y,
          nextPosition.z,
          nextTarget.x,
          nextTarget.y,
          nextTarget.z,
          false
        )
        return true
      }

      if (typeof controls.setPosition === 'function' && typeof controls.setTarget === 'function') {
        controls.setPosition(nextPosition.x, nextPosition.y, nextPosition.z, false)
        controls.setTarget(nextTarget.x, nextTarget.y, nextTarget.z, false)
        return true
      }
    }

    if (typeof controls.setPosition === 'function' && typeof controls.setTarget === 'function') {
      controls.setPosition(point.x, point.y, point.z, false)
      controls.setTarget(point.x, point.y, point.z - 1, false)
      return true
    }

    if (typeof controls.setLookAt === 'function') {
      controls.setLookAt(point.x, point.y, point.z, point.x, point.y, point.z - 1, false)
      return true
    }

    return false
  }, [])

  const moveCameraAlongView = useCallback((rawWheelDelta: number) => {
    const viewer = viewerRef.current
    const controls = viewer?.context?.ifcCamera?.cameraControls as
      | {
          getPosition?: (out: Vector3) => void
          getTarget?: (out: Vector3) => void
          setPosition?: (x: number, y: number, z: number, enableTransition?: boolean) => void
          setTarget?: (x: number, y: number, z: number, enableTransition?: boolean) => void
          setLookAt?: (
            positionX: number,
            positionY: number,
            positionZ: number,
            targetX: number,
            targetY: number,
            targetZ: number,
            enableTransition?: boolean
          ) => void
        }
      | undefined
    if (!controls?.getPosition || !controls?.getTarget) return false

    const wheelDelta = Math.max(-FREE_WHEEL_MAX_DELTA, Math.min(FREE_WHEEL_MAX_DELTA, rawWheelDelta))
    if (Math.abs(wheelDelta) < 1e-6) return false

    const position = new Vector3()
    const target = new Vector3()
    controls.getPosition(position)
    controls.getTarget(target)

    const direction = target.clone().sub(position)
    if (direction.lengthSq() <= 1e-8) return false
    direction.normalize()

    const move = direction.multiplyScalar(-wheelDelta * FREE_WHEEL_MOVE_FACTOR)
    const nextPosition = position.clone().add(move)
    const nextTarget = target.clone().add(move)

    if (typeof controls.setLookAt === 'function') {
      controls.setLookAt(
        nextPosition.x,
        nextPosition.y,
        nextPosition.z,
        nextTarget.x,
        nextTarget.y,
        nextTarget.z,
        false
      )
      return true
    }

    if (typeof controls.setPosition === 'function' && typeof controls.setTarget === 'function') {
      controls.setPosition(nextPosition.x, nextPosition.y, nextPosition.z, false)
      controls.setTarget(nextTarget.x, nextTarget.y, nextTarget.z, false)
      return true
    }

    return false
  }, [])

  const handlePickMenuSelect = useCallback(
    (candidateId: string) => {
      const candidate = pickMenuLookup.get(candidateId)
      closePickMenu()
      if (!candidate) return
      if (candidate.kind === 'custom') {
        selectCustomCube(candidate.expressID)
      } else {
        void selectById(candidate.modelID, candidate.expressID)
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

  const finishRotateMode = useCallback(
    (options?: { commit?: boolean; revert?: boolean }) => {
      const shouldCommit = options?.commit ?? false
      const shouldRevert = options?.revert ?? false
      const start = rotateStartValueRef.current
      const current = rotateCurrentValueRef.current

      if (shouldRevert && start) {
        rotateSelectedTo(start)
      } else if (shouldCommit && start && current) {
        const changed =
          Math.abs(current.x - start.x) >= ROTATION_EPSILON ||
          Math.abs(current.y - start.y) >= ROTATION_EPSILON ||
          Math.abs(current.z - start.z) >= ROTATION_EPSILON
        if (changed) {
          syncSelectedCubePosition()
          syncSelectedIfcPosition()
          if (selectedElement && selectedElement.modelID !== CUSTOM_CUBE_MODEL_ID) {
            pushHistoryEntry(selectedElement.expressID, 'Rotation updated')
          }
        }
      }

      setIsRotating(false)
      setRotateAxisLock(null)
      rotateStartPointerRef.current = null
      rotateStartValueRef.current = null
      rotateCurrentValueRef.current = null
    },
    [
      pushHistoryEntry,
      rotateSelectedTo,
      selectedElement,
      syncSelectedCubePosition,
      syncSelectedIfcPosition
    ]
  )

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
    onMetadataChange(metadataEntries)
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
        const node: ObjectTree['nodes'][string] | undefined = tree.nodes[currentId]
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

  const resolveNodeInsertTarget = useCallback(
    async (nodeId: string, options?: { autoFocus?: boolean }): Promise<Point3D> => {
      const node = tree.nodes[nodeId]
      if (!node || node.nodeType !== 'ifc' || node.expressID === null) {
        return { x: 0, y: 0, z: 0 }
      }

      const target = await selectById(node.modelID, node.expressID, {
        autoFocus: options?.autoFocus
      })
      return target ?? { x: 0, y: 0, z: 0 }
    },
    [selectById, tree.nodes]
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

  const handleTreeAddCube = useCallback(
    async (nodeId: string) => {
      // Spawn at the same coordinates resolved from parent selection (fallback to origin).
      const resolvedTarget = await resolveNodeInsertTarget(nodeId)
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
      registerCubeFurniture,
      resolveNodeInsertTarget,
      resolveRoomNumberForNode,
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
    const viewer = viewerRef.current ?? ensureViewer()
    if (!viewer) return
    applyNavigationControls(viewer, navigationMode)
    if (!isWalkMode) {
      stopWalkMovementLoop()
    }
  }, [ensureViewer, isWalkMode, navigationMode, stopWalkMovementLoop])

  useEffect(() => {
    if (!isWalkMode) return

    const up = new Vector3(0, 1, 0)
    const position = new Vector3()
    const target = new Vector3()
    const forward = new Vector3()
    const right = new Vector3()
    const move = new Vector3()

    const tick = (timestamp: number) => {
      const viewer = viewerRef.current
      const controls = viewer?.context?.ifcCamera?.cameraControls
      if (!controls || typeof controls.getPosition !== 'function' || typeof controls.getTarget !== 'function') {
        walkFrameRef.current = requestAnimationFrame(tick)
        return
      }

      const lastTimestamp = walkLastTimestampRef.current ?? timestamp
      walkLastTimestampRef.current = timestamp
      const deltaTime = Math.min((timestamp - lastTimestamp) / 1000, 0.05)

      const keys = walkKeyStateRef.current
      const forwardInput = (keys.arrowup ? 1 : 0) - (keys.arrowdown ? 1 : 0)
      const strafeInput = (keys.arrowright ? 1 : 0) - (keys.arrowleft ? 1 : 0)
      const isMoving = forwardInput !== 0 || strafeInput !== 0

      if (walkMoveActiveRef.current !== isMoving) {
        walkMoveActiveRef.current = isMoving
        setWalkOverlaySuppressed(isMoving || walkDragActiveRef.current || walkLookActiveRef.current)
      }

      if (deltaTime > 0 && isMoving) {
        controls.getPosition(position)
        controls.getTarget(target)

        forward.subVectors(target, position)
        forward.y = 0
        if (forward.lengthSq() > 1e-8) {
          forward.normalize()
          walkHeadingRef.current.copy(forward)
        } else {
          forward.copy(walkHeadingRef.current)
        }

        right.crossVectors(forward, up).normalize()

        move.set(0, 0, 0)
        move.addScaledVector(forward, forwardInput)
        move.addScaledVector(right, strafeInput)
        if (move.lengthSq() > 1e-8) {
          move.normalize().multiplyScalar(WALK_MOVE_SPEED * deltaTime)
          position.add(move)
          target.add(move)
          controls.setLookAt(
            position.x,
            position.y,
            position.z,
            target.x,
            target.y,
            target.z,
            false
          )
        }
      }

      walkFrameRef.current = requestAnimationFrame(tick)
    }

    walkFrameRef.current = requestAnimationFrame(tick)
    return () => {
      stopWalkMovementLoop()
    }
  }, [isWalkMode, setWalkOverlaySuppressed, stopWalkMovementLoop])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const handlePointerDown = (event: PointerEvent) => {
      if (!isWalkMode) return
      if (event.button === 1) {
        walkLookActiveRef.current = true
        walkLookPointerIdRef.current = event.pointerId
        walkLookLastPointerRef.current = { x: event.clientX, y: event.clientY }
      } else if (event.button === 2) {
        walkDragActiveRef.current = true
        walkDragPointerIdRef.current = event.pointerId
        walkDragLastPointerRef.current = { x: event.clientX, y: event.clientY }
      } else {
        return
      }
      setWalkOverlaySuppressed(true)
      try {
        container.setPointerCapture(event.pointerId)
      } catch {
        // Ignore capture errors for unsupported platforms.
      }
      event.preventDefault()
    }

    const handlePointerMove = (event: PointerEvent) => {
      if (!isWalkMode) return

      const isLookPointer =
        walkLookActiveRef.current &&
        (walkLookPointerIdRef.current === null || event.pointerId === walkLookPointerIdRef.current)
      if (isLookPointer) {
        const lastPointer = walkLookLastPointerRef.current
        walkLookLastPointerRef.current = { x: event.clientX, y: event.clientY }
        if (!lastPointer) return
        const deltaX = event.clientX - lastPointer.x
        const deltaY = event.clientY - lastPointer.y
        if (deltaX === 0 && deltaY === 0) return
        updateWalkLookByDelta(deltaX, deltaY)
        event.preventDefault()
        return
      }

      const isDragPointer =
        walkDragActiveRef.current &&
        (walkDragPointerIdRef.current === null || event.pointerId === walkDragPointerIdRef.current)
      if (!isDragPointer) return

      const lastPointer = walkDragLastPointerRef.current
      walkDragLastPointerRef.current = { x: event.clientX, y: event.clientY }
      if (!lastPointer) return

      const deltaX = event.clientX - lastPointer.x
      const deltaY = event.clientY - lastPointer.y
      if (deltaX === 0 && deltaY === 0) return

      const viewer = viewerRef.current
      const controls = viewer?.context?.ifcCamera?.cameraControls as
        | {
            getPosition?: (out: Vector3) => void
            getTarget?: (out: Vector3) => void
            setLookAt?: (
              positionX: number,
              positionY: number,
              positionZ: number,
              targetX: number,
              targetY: number,
              targetZ: number,
              enableTransition?: boolean
            ) => void
          }
        | undefined
      if (!controls?.getPosition || !controls?.getTarget || !controls?.setLookAt) return

      const position = new Vector3()
      const target = new Vector3()
      const forward = new Vector3()
      const right = new Vector3()
      const up = new Vector3(0, 1, 0)
      controls.getPosition(position)
      controls.getTarget(target)

      forward.subVectors(target, position)
      forward.y = 0
      if (forward.lengthSq() > 1e-8) {
        forward.normalize()
        walkHeadingRef.current.copy(forward)
      } else {
        forward.copy(walkHeadingRef.current)
      }
      right.crossVectors(forward, up).normalize()

      const move = new Vector3()
      move.addScaledVector(right, deltaX * WALK_DRAG_MOVE_PER_PIXEL)
      move.addScaledVector(forward, -deltaY * WALK_DRAG_MOVE_PER_PIXEL)
      position.add(move)
      target.add(move)

      controls.setLookAt(
        position.x,
        position.y,
        position.z,
        target.x,
        target.y,
        target.z,
        false
      )
      event.preventDefault()
    }

    const stopLook = (event?: PointerEvent) => {
      if (event && event.button !== 1) return
      if (event && walkLookPointerIdRef.current !== null && event.pointerId !== walkLookPointerIdRef.current) {
        return
      }
      const pointerId = walkLookPointerIdRef.current
      walkLookActiveRef.current = false
      walkLookPointerIdRef.current = null
      walkLookLastPointerRef.current = null
      setWalkOverlaySuppressed(walkMoveActiveRef.current || walkDragActiveRef.current)
      if (pointerId !== null) {
        try {
          container.releasePointerCapture(pointerId)
        } catch {
          // Ignore release errors for unsupported platforms.
        }
      }
    }

    const stopDragMove = (event?: PointerEvent) => {
      if (event && event.button !== 2) return
      if (event && walkDragPointerIdRef.current !== null && event.pointerId !== walkDragPointerIdRef.current) {
        return
      }
      const pointerId = walkDragPointerIdRef.current
      walkDragActiveRef.current = false
      walkDragPointerIdRef.current = null
      walkDragLastPointerRef.current = null
      setWalkOverlaySuppressed(walkMoveActiveRef.current || walkLookActiveRef.current)
      if (pointerId !== null) {
        try {
          container.releasePointerCapture(pointerId)
        } catch {
          // Ignore release errors for unsupported platforms.
        }
      }
    }

    const handleContextMenu = (event: MouseEvent) => {
      if (!isWalkMode) return
      event.preventDefault()
    }

    const handleWindowBlur = () => {
      stopLook()
      stopDragMove()
    }

    container.addEventListener('pointerdown', handlePointerDown)
    container.addEventListener('pointermove', handlePointerMove)
    container.addEventListener('contextmenu', handleContextMenu)
    window.addEventListener('pointerup', stopLook)
    window.addEventListener('pointerup', stopDragMove)
    window.addEventListener('blur', handleWindowBlur)
    return () => {
      container.removeEventListener('pointerdown', handlePointerDown)
      container.removeEventListener('pointermove', handlePointerMove)
      container.removeEventListener('contextmenu', handleContextMenu)
      window.removeEventListener('pointerup', stopLook)
      window.removeEventListener('pointerup', stopDragMove)
      window.removeEventListener('blur', handleWindowBlur)
      stopLook()
      stopDragMove()
    }
  }, [isWalkMode, setWalkOverlaySuppressed, updateWalkLookByDelta])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const handleSelectClick = (clientX: number, clientY: number) => {
      const rect = container.getBoundingClientRect()
      const candidates = pickCandidatesAt(clientX, clientY, container, 0.02)

      if (candidates.length > 1) {
        setPickCandidates(candidates)
        setIsPickMenuOpen(true)
        setPickMenuAnchor({
          x: Math.max(0, Math.min(clientX - rect.left + 12, rect.width - 12)),
          y: Math.max(0, Math.min(clientY - rect.top + 12, rect.height - 12))
        })
        return
      }

      if (candidates.length === 1) {
        closePickMenu()
        const only = candidates[0]
        if (only.kind === 'custom') {
          selectCustomCube(only.expressID)
        } else {
          void selectById(only.modelID, only.expressID, { autoFocus: false })
        }
        return
      }

      closePickMenu()
      resetSelection()
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return
      if (isRotating) {
        finishRotateMode({ commit: true })
        event.preventDefault()
      }
    }

    const handleClick = (event: MouseEvent) => {
      if (event.button !== 0) return
      handleSelectClick(event.clientX, event.clientY)
      event.preventDefault()
    }

    container.addEventListener('pointerdown', handlePointerDown)
    container.addEventListener('click', handleClick)
    return () => {
      container.removeEventListener('pointerdown', handlePointerDown)
      container.removeEventListener('click', handleClick)
    }
  }, [
    closePickMenu,
    finishRotateMode,
    isRotating,
    pickCandidatesAt,
    resetSelection,
    selectById,
    selectCustomCube
  ])

  useEffect(() => {
    if (isWalkMode) return
    const container = containerRef.current
    if (!container) return

    const handleWheel = (event: WheelEvent) => {
      if (event.ctrlKey || event.metaKey) return
      const deltaMultiplier = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 120 : 1
      const normalizedDelta = event.deltaY * deltaMultiplier
      const changed = moveCameraAlongView(normalizedDelta)
      if (changed) {
        event.preventDefault()
      }
    }

    container.addEventListener('wheel', handleWheel, { passive: false })
    return () => {
      container.removeEventListener('wheel', handleWheel)
    }
  }, [isWalkMode, moveCameraAlongView])

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
      if (isRotating) {
        const startPointer = rotateStartPointerRef.current
        const startRotation = rotateStartValueRef.current
        if (!startPointer || !startRotation) {
          return
        }
        const deltaX = event.clientX - startPointer.x
        const deltaY = event.clientY - startPointer.y
        const nextRotation = {
          x: startRotation.x,
          y: startRotation.y,
          z: startRotation.z
        }
        if (rotateAxisLock === 'x') {
          nextRotation.x += deltaY * ROTATE_DRAG_SENSITIVITY
        } else if (rotateAxisLock === 'y') {
          nextRotation.y += deltaX * ROTATE_DRAG_SENSITIVITY
        } else if (rotateAxisLock === 'z') {
          nextRotation.z += deltaX * ROTATE_DRAG_SENSITIVITY
        } else {
          nextRotation.x += deltaY * ROTATE_DRAG_SENSITIVITY
          nextRotation.y += deltaX * ROTATE_DRAG_SENSITIVITY
        }
        rotateCurrentValueRef.current = nextRotation
        rotateSelectedTo(nextRotation)
        event.preventDefault()
      } else if (isDragging) {
        // Dragging: project cursor onto the active drag plane and apply axis lock.
        const viewer = viewerRef.current
        const plane = dragPlaneRef.current
        if (viewer && plane && containerRef.current) {
          const rect = containerRef.current.getBoundingClientRect()
          const ndc = new Vector2(
            (event.clientX - rect.left) / rect.width * 2 - 1,
            -(event.clientY - rect.top) / rect.height * 2 + 1
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
  }, [dragAxisLock, isDragging, isRotating, moveSelectedTo, rotateAxisLock, rotateSelectedTo, updateHoverCoords])

  useEffect(() => {
    if (!selectedElement) {
      setSelectedNodeId(null)
      return
    }

    const matchId = resolveTreeNodeIdForSelection(selectedElement.modelID, selectedElement.expressID)
    setSelectedNodeId(matchId)
  }, [resolveTreeNodeIdForSelection, selectedElement])

  useEffect(() => {
    const isEditableTarget = (target: EventTarget | null) => {
      const element = target as HTMLElement | null
      if (!element) return false
      const tagName = element.tagName
      return element.isContentEditable || tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT'
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target)) return
      const key = event.key.toLowerCase()
      const walkMoveKey = getWalkMoveKey(event)

      if (isWalkMode && walkMoveKey) {
        walkKeyStateRef.current[walkMoveKey] = true
        event.preventDefault()
        return
      }

      if (showShortcuts && (event.key === '?' || event.key.toLowerCase() === 'h')) {
        setIsShortcutsOpen((prev) => !prev)
        return
      }
      if (key === 'm') {
        toggleNavigationMode()
        return
      }
      if (key === 'r') {
        if (!selectedElement) return
        const container = containerRef.current
        if (container) {
          const rect = container.getBoundingClientRect()
          rotateStartPointerRef.current = {
            x: rect.left + lastPointerPosRef.current.x,
            y: rect.top + lastPointerPosRef.current.y
          }
        } else {
          rotateStartPointerRef.current = { x: 0, y: 0 }
        }
        const startRotation =
          getIfcElementRotationDelta(selectedElement.modelID, selectedElement.expressID) ?? {
            x: 0,
            y: 0,
            z: 0
          }
        rotateStartValueRef.current = {
          x: startRotation.x,
          y: startRotation.y,
          z: startRotation.z
        }
        rotateCurrentValueRef.current = {
          x: startRotation.x,
          y: startRotation.y,
          z: startRotation.z
        }
        setIsDragging(false)
        setDragAxisLock(null)
        dragPlaneRef.current = null
        dragStartPointRef.current = null
        dragStartOffsetRef.current = null
        setIsRotating(true)
        setRotateAxisLock(null)
        event.preventDefault()
        return
      }
      if (!isWalkMode && key === 'a') {
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
      if (key === 'g') {
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
      if (isDragging && key === 'f') {
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
          const ndc = new Vector2(
            (lastPointerPosRef.current.x / rect.width) * 2 - 1,
            -(lastPointerPosRef.current.y / rect.height) * 2 + 1
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
      if (isRotating && (key === 'x' || key === 'y' || key === 'z')) {
        setRotateAxisLock(key as 'x' | 'y' | 'z')
      }
      if (isDragging && (key === 'x' || key === 'y' || key === 'z')) {
        setDragAxisLock(key as 'x' | 'y' | 'z')
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
        finishRotateMode({ revert: true })
        setIsShortcutsOpen(false)
        closePickMenu()
      }
    }

    const handleKeyUp = (event: KeyboardEvent) => {
      const walkMoveKey = getWalkMoveKey(event)
      if (walkMoveKey) {
        walkKeyStateRef.current[walkMoveKey] = false
      }
    }

    const handleWindowBlur = () => {
      walkKeyStateRef.current = { ...emptyWalkKeyState }
      if (isRotating) {
        finishRotateMode({ revert: true })
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
    window.addEventListener('keyup', handleKeyUp)
    window.addEventListener('blur', handleWindowBlur)
    window.addEventListener('pointerup', handlePointerUp)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
      window.removeEventListener('blur', handleWindowBlur)
      window.removeEventListener('pointerup', handlePointerUp)
    }
  }, [
    closePickMenu,
    finishRotateMode,
    getIfcElementRotationDelta,
    getSelectedWorldPosition,
    hoverCoords,
    isRotating,
    isWalkMode,
    isDragging,
    offsetInputs,
    pickCandidatesAt,
    selectById,
    selectCustomCube,
    selectedElement,
    pushHistoryEntry,
    showShortcuts,
    syncSelectedCubePosition,
    syncSelectedIfcPosition,
    toggleNavigationMode
  ])

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
      applyNavigationControls(viewer, navigationModeRef.current)

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

