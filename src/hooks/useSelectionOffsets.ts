import { useCallback, useRef, useState } from 'react'
// Encapsulates selection, IFC property fetching, and offset/subset handling
import {
  BufferGeometry,
  BoxGeometry,
  DoubleSide,
  Euler,
  Float32BufferAttribute,
  FrontSide,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Quaternion,
  Raycaster,
  Vector2,
  Vector3
} from 'three'
import type { IfcViewerAPI } from '../viewer/IfcViewerAPICompat'
import type {
  FurnitureGeometry,
  OffsetVector,
  Point3D,
  PropertyField,
  SelectedElement
} from '../ifcViewerTypes'

const BASE_SUBSET_ID = 'base-offset-subset'
const MOVED_SUBSET_PREFIX = 'moved-offset-'
const FILTER_SUBSET_PREFIX = 'filter-subset-'
const SPACE_BIAS_SUBSET_PREFIX = 'space-bias-subset-'
const SELECTION_SUBSET_PREFIX = 'selection-subset-'
const zeroOffset: OffsetVector = { dx: 0, dy: 0, dz: 0 }
const CUBE_BASE_COLOR = 0x4f46e5
const CUBE_HIGHLIGHT_COLOR = 0xffb100
const IFC_SELECTION_COLOR = 0xffbf00
const IFC_SELECTION_EMISSIVE = 0x6a3d00
const COORD_EPSILON = 1e-4
export const CUSTOM_CUBE_MODEL_ID = -999

const normalizeIfcIds = (ids: number[]): number[] => {
  const dedup = new Set<number>()
  ids.forEach((rawId) => {
    if (!Number.isFinite(rawId)) return
    dedup.add(Math.trunc(rawId))
  })
  return Array.from(dedup)
}

const tuneSpaceBiasSubsetMesh = (_mesh: Mesh | null | undefined) => {}

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
    {
      material?:
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
        | Array<{
            side?: number
            depthTest?: boolean
            depthWrite?: boolean
            transparent?: boolean
            polygonOffset?: boolean
            polygonOffsetFactor?: number
            polygonOffsetUnits?: number
            needsUpdate?: boolean
          }>
      children?: unknown[]
    }
  > = [
    model as {
      material?:
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
        | Array<{
            side?: number
            depthTest?: boolean
            depthWrite?: boolean
            transparent?: boolean
            polygonOffset?: boolean
            polygonOffsetFactor?: number
            polygonOffsetUnits?: number
            needsUpdate?: boolean
          }>
      children?: unknown[]
    }
  ]
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
        stack.push(
          child as {
            material?:
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
              | Array<{
                  side?: number
                  depthTest?: boolean
                  depthWrite?: boolean
                  transparent?: boolean
                  polygonOffset?: boolean
                  polygonOffsetFactor?: number
                  polygonOffsetUnits?: number
                  needsUpdate?: boolean
                }>
            children?: unknown[]
          }
        )
      )
    }
  }
}

export type PickCandidate = {
  modelID: number
  expressID: number
  kind: 'ifc' | 'custom'
  distance: number
}

type SpawnedCubeInfo = {
  expressID: number
  position: Point3D
}

type SpawnCubeOptions = {
  focus?: boolean
  id?: number
}

type SpawnedModelInfo = {
  modelID: number
  position: Point3D
  geometry: FurnitureGeometry | null
}

const serializeMeshGeometry = (
  mesh: Mesh
): { geometry: FurnitureGeometry | null; center: Point3D } => {
  const geometry = mesh.geometry as BufferGeometry | undefined
  if (!geometry) {
    return {
      geometry: null,
      center: { x: 0, y: 0, z: 0 }
    }
  }
  const positions = geometry.getAttribute('position')
  if (!positions || typeof positions.getX !== 'function') {
    return {
      geometry: null,
      center: { x: 0, y: 0, z: 0 }
    }
  }

  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let minZ = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  let maxZ = Number.NEGATIVE_INFINITY
  for (let index = 0; index < positions.count; index += 1) {
    const x = Number(positions.getX(index))
    const y = Number(positions.getY(index))
    const z = Number(positions.getZ(index))
    if (x < minX) minX = x
    if (y < minY) minY = y
    if (z < minZ) minZ = z
    if (x > maxX) maxX = x
    if (y > maxY) maxY = y
    if (z > maxZ) maxZ = z
  }
  const centerVector = new Vector3(
    Number.isFinite(minX) && Number.isFinite(maxX) ? (minX + maxX) * 0.5 : 0,
    Number.isFinite(minY) && Number.isFinite(maxY) ? (minY + maxY) * 0.5 : 0,
    Number.isFinite(minZ) && Number.isFinite(maxZ) ? (minZ + maxZ) * 0.5 : 0
  )
  const center = { x: centerVector.x, y: centerVector.y, z: centerVector.z }

  const serializedPositions: number[] = []
  for (let index = 0; index < positions.count; index += 1) {
    serializedPositions.push(
      Number(positions.getX(index) - center.x),
      Number(positions.getY(index) - center.y),
      Number(positions.getZ(index) - center.z)
    )
  }

  const serializedIndices: number[] = []
  const indexAttr = geometry.index
  if (indexAttr && typeof indexAttr.getX === 'function') {
    for (let index = 0; index < indexAttr.count; index += 1) {
      serializedIndices.push(Math.trunc(indexAttr.getX(index)))
    }
  } else {
    for (let index = 0; index < positions.count; index += 1) {
      serializedIndices.push(index)
    }
  }

  if (serializedPositions.length < 9 || serializedIndices.length < 3) {
    return {
      geometry: null,
      center
    }
  }

  return {
    geometry: {
      positions: serializedPositions,
      indices: serializedIndices
    },
    center
  }
}

type SelectionTypeFilterOptions = {
  allowedIfcTypes?: string[]
}

type UseSelectionOffsetsResult = {
  selectedElement: SelectedElement | null
  offsetInputs: OffsetVector
  propertyFields: PropertyField[]
  propertyError: string | null
  isFetchingProperties: boolean
  handleOffsetInputChange: (axis: keyof OffsetVector, value: number) => void
  applyOffsetToSelectedElement: () => void
  handleFieldChange: (key: string, value: string) => void
  handlePick: (options?: { autoFocus?: boolean; allowedIfcTypes?: string[] }) => Promise<void>
  selectById: (
    modelID: number,
    expressID: number,
    options?: { autoFocus?: boolean; allowedIfcTypes?: string[] }
  ) => Promise<Point3D | null>
  selectCustomCube: (expressID: number) => void
  clearIfcHighlight: () => void
  highlightIfcGroup: (
    modelID: number,
    expressIDs: number[],
    options?: { anchorExpressID?: number | null }
  ) => void
  hasRenderableExpressId: (modelID: number, expressID: number) => boolean
  getIfcElementBasePosition: (modelID: number, expressID: number) => Point3D | null
  getIfcElementTranslationDelta: (modelID: number, expressID: number) => Point3D | null
  getIfcElementRotationDelta: (modelID: number, expressID: number) => Point3D | null
  getElementWorldPosition: (modelID: number, expressID: number) => Point3D | null
  moveSelectedTo: (targetOffset: OffsetVector) => void
  applyIfcElementOffset: (modelID: number, expressID: number, targetOffset: OffsetVector) => void
  applyIfcElementRotation: (modelID: number, expressID: number, targetRotation: Point3D) => void
  rotateSelectedTo: (targetRotation: Point3D) => void
  hideIfcElement: (modelID: number, expressID: number) => void
  setCustomCubeRoomNumber: (expressID: number, roomNumber?: string | null) => void
  ensureCustomCubesPickable: () => void
  pickCandidatesAt: (
    clientX: number,
    clientY: number,
    container: HTMLElement,
    maxDistance?: number
  ) => PickCandidate[]
  getSelectedWorldPosition: () => Vector3 | null
  resetSelection: () => void
  clearOffsetArtifacts: (modelID?: number | null) => void
  spawnCube: (target?: Point3D | null, options?: SpawnCubeOptions) => SpawnedCubeInfo | null
  removeCustomCube: (expressID: number) => void
  spawnUploadedModel: (
    file: File,
    target?: Point3D | null,
    options?: { focus?: boolean }
  ) => Promise<SpawnedModelInfo | null>
  applyVisibilityFilter: (modelID: number, visibleIds: number[] | null) => void
  configureSpaceBiasTargets: (modelID: number, expressIDs: number[]) => void
}

export const useSelectionOffsets = (
  viewerRef: { current: IfcViewerAPI | null }
): UseSelectionOffsetsResult => {
  // Local caches for subsets/cubes/offsets; kept outside React state to avoid re-renders
  const propertyRequestRef = useRef(0)
  const baseSubsetsRef = useRef<Map<number, Mesh>>(new Map())
  const movedSubsetsRef = useRef<Map<string, Mesh>>(new Map())
  const spaceBiasSubsetsRef = useRef<Map<number, Mesh>>(new Map())
  const spaceBiasIdsRef = useRef<Map<number, Set<number>>>(new Map())
  const spaceBiasAppliedRef = useRef<Map<number, Set<number>>>(new Map())
  const hiddenIdsRef = useRef<Map<number, Set<number>>>(new Map())
  const elementOffsetsRef = useRef<Map<string, OffsetVector>>(new Map())
  const elementRotationsRef = useRef<Map<string, Point3D>>(new Map())
  const expressIdCacheRef = useRef<Map<number, Set<number>>>(new Map())
  const baseCentersRef = useRef<Map<string, Point3D>>(new Map())
  const filterSubsetsRef = useRef<Map<number, Mesh>>(new Map())
  const filterIdsRef = useRef<Map<number, Set<number> | null>>(new Map())
  const cubeRegistryRef = useRef<Map<number, Mesh>>(new Map())
  const cubeIdCounterRef = useRef(1)
  const highlightedCubeRef = useRef<number | null>(null)
  const highlightedIfcRef = useRef<{ modelID: number; expressID: number } | null>(null)
  const selectionSubsetsRef = useRef<Map<number, Mesh>>(new Map())
  const selectionMaterialRef = useRef<MeshStandardMaterial | null>(null)
  const focusOffsetRef = useRef<Point3D | null>(null)
  const customCubeRoomsRef = useRef<Map<number, string>>(new Map())

  const [selectedElement, setSelectedElement] = useState<SelectedElement | null>(null)
  const [offsetInputs, setOffsetInputs] = useState<OffsetVector>(zeroOffset)
  const [propertyFields, setPropertyFields] = useState<PropertyField[]>([])
  const [propertyError, setPropertyError] = useState<string | null>(null)
  const [isFetchingProperties, setIsFetchingProperties] = useState(false)
  const normalizeIfcTypeName = useCallback((value: unknown): string | null => {
    if (typeof value !== 'string') return null
    const trimmed = value.trim()
    return trimmed ? trimmed.toUpperCase() : null
  }, [])

  const resolveIfcTypeName = useCallback(
    async (viewer: IfcViewerAPI, modelID: number, expressID: number): Promise<string | null> => {
      try {
        const manager = viewer.IFC?.loader?.ifcManager as
          | { getIfcType?: (idModel: number, idExpress: number) => string | undefined }
          | undefined
        const directType = manager?.getIfcType?.(modelID, expressID)
        if (directType) {
          return normalizeIfcTypeName(directType)
        }

        const props = await viewer.IFC.getProperties(modelID, expressID, false, false)
        return normalizeIfcTypeName(
          typeof props?.ifcClass === 'string'
            ? props.ifcClass
            : typeof props?.type === 'string'
              ? props.type
              : null
        )
      } catch (err) {
        console.warn('Failed to resolve IFC type for selection filter', expressID, err)
        return null
      }
    },
    [normalizeIfcTypeName]
  )

  const isIfcSelectionAllowed = useCallback(
    async (
      viewer: IfcViewerAPI,
      modelID: number,
      expressID: number,
      options?: SelectionTypeFilterOptions
    ): Promise<boolean> => {
      const allowedIfcTypes = options?.allowedIfcTypes
      if (!allowedIfcTypes || allowedIfcTypes.length === 0) {
        return true
      }
      const normalizedAllowed = new Set(
        allowedIfcTypes
          .map((typeName) => normalizeIfcTypeName(typeName))
          .filter((typeName): typeName is string => Boolean(typeName))
      )
      if (normalizedAllowed.size === 0) {
        return true
      }
      const resolvedType = await resolveIfcTypeName(viewer, modelID, expressID)
      return Boolean(resolvedType && normalizedAllowed.has(resolvedType))
    },
    [normalizeIfcTypeName, resolveIfcTypeName]
  )

  const getSelectionSubsetId = useCallback((modelID: number) => {
    return `${SELECTION_SUBSET_PREFIX}${modelID}`
  }, [])

  const getSelectionMaterial = useCallback(() => {
    if (!selectionMaterialRef.current) {
      selectionMaterialRef.current = new MeshStandardMaterial({
        color: IFC_SELECTION_COLOR,
        emissive: IFC_SELECTION_EMISSIVE,
        side: DoubleSide,
        roughness: 0.45,
        metalness: 0,
        transparent: true,
        opacity: 0.45,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2
      })
    }
    return selectionMaterialRef.current
  }, [])

  const clearIfcSelectionHighlight = useCallback(
    (modelID?: number | null) => {
      const viewer = viewerRef.current
      const idsToClear =
        typeof modelID === 'number' ? [modelID] : Array.from(selectionSubsetsRef.current.keys())

      if (!viewer) {
        idsToClear.forEach((id) => selectionSubsetsRef.current.delete(id))
        if (typeof modelID !== 'number' || highlightedIfcRef.current?.modelID === modelID) {
          highlightedIfcRef.current = null
        }
        return
      }

      const manager = viewer.IFC.loader.ifcManager
      const scene = viewer.context.getScene()
      idsToClear.forEach((id) => {
        const subset = selectionSubsetsRef.current.get(id)
        if (subset) {
          scene.remove(subset)
          selectionSubsetsRef.current.delete(id)
        }
        manager.removeSubset(id, undefined, getSelectionSubsetId(id))
      })
      if (typeof modelID !== 'number' || highlightedIfcRef.current?.modelID === modelID) {
        highlightedIfcRef.current = null
      }
    },
    [getSelectionSubsetId, viewerRef]
  )

  const focusOnPoint = useCallback(
    (point: Point3D | null) => {
      const viewer = viewerRef.current
      if (!viewer || !point) return
      const controls = viewer.context.ifcCamera.cameraControls
      const currentPosition = new Vector3()
      const currentTarget = new Vector3()
      controls.getPosition(currentPosition)
      controls.getTarget(currentTarget)

      const direction = currentPosition.clone().sub(currentTarget)
      let distance = direction.length()
      if (!Number.isFinite(distance) || distance < 0.001) {
        direction.set(1, 0.6, 1)
        distance = 10
      }
      direction.normalize()

      // Keep orientation but bring camera closer so focus feels like actual zoom-to-element.
      const desiredDistance = Math.min(Math.max(distance * 0.6, 2.5), 16)
      const nextPosition = new Vector3(point.x, point.y, point.z).addScaledVector(
        direction,
        desiredDistance
      )
      controls.setLookAt(
        nextPosition.x,
        nextPosition.y,
        nextPosition.z,
        point.x,
        point.y,
        point.z,
        true
      )
    },
    [viewerRef]
  )

  const setCubeHighlight = useCallback((expressID: number | null) => {
    // Toggle cube color to indicate selection
    if (highlightedCubeRef.current !== null && highlightedCubeRef.current !== expressID) {
      const prevCube = cubeRegistryRef.current.get(highlightedCubeRef.current)
      const prevMaterial = prevCube?.material as MeshStandardMaterial
      if (prevMaterial?.color) {
        prevMaterial.color.set(CUBE_BASE_COLOR)
      }
    }

    if (expressID === null) {
      highlightedCubeRef.current = null
      return
    }

    const cube = cubeRegistryRef.current.get(expressID)
    const material = cube?.material as MeshStandardMaterial
    if (material?.color) {
      material.color.set(CUBE_HIGHLIGHT_COLOR)
      highlightedCubeRef.current = expressID
    }
  }, [])

  const getSelectedWorldPosition = useCallback((): Vector3 | null => {
    if (!selectedElement) return null
    if (selectedElement.modelID === CUSTOM_CUBE_MODEL_ID) {
      const cube = cubeRegistryRef.current.get(selectedElement.expressID)
      return cube ? cube.position.clone() : null
    }
    return new Vector3(offsetInputs.dx, offsetInputs.dy, offsetInputs.dz)
  }, [offsetInputs, selectedElement])

  const resetSelection = useCallback(() => {
    // Cancel in-flight property requests and clear UI state
    propertyRequestRef.current += 1
    setSelectedElement(null)
    setOffsetInputs(zeroOffset)
    setPropertyFields([])
    setPropertyError(null)
    setIsFetchingProperties(false)
    setCubeHighlight(null)
    focusOffsetRef.current = null
    clearIfcSelectionHighlight()
    viewerRef.current?.IFC.selector.unpickIfcItems()
  }, [clearIfcSelectionHighlight, setCubeHighlight, viewerRef])

  const getElementKey = useCallback((modelID: number, expressID: number) => {
    return `${modelID}:${expressID}`
  }, [])

  const normalizeRotation = useCallback((rotation: Point3D | null | undefined): Point3D => {
    return {
      x: Number.isFinite(rotation?.x) ? Number(rotation?.x) : 0,
      y: Number.isFinite(rotation?.y) ? Number(rotation?.y) : 0,
      z: Number.isFinite(rotation?.z) ? Number(rotation?.z) : 0
    }
  }, [])

  const isZeroRotation = useCallback((rotation: Point3D | null | undefined) => {
    if (!rotation) return true
    return (
      Math.abs(rotation.x) < COORD_EPSILON &&
      Math.abs(rotation.y) < COORD_EPSILON &&
      Math.abs(rotation.z) < COORD_EPSILON
    )
  }, [])

  const getFilterSubsetId = useCallback((modelID: number) => {
    return `${FILTER_SUBSET_PREFIX}${modelID}`
  }, [])

  const getSpaceBiasSubsetId = useCallback((modelID: number) => {
    return `${SPACE_BIAS_SUBSET_PREFIX}${modelID}`
  }, [])

  const getModelBaseOffset = useCallback(
    (modelID: number): OffsetVector => {
      // Prefer original mesh position; fall back to stored subset position
      const viewer = viewerRef.current
      const mesh = viewer?.IFC.loader.ifcManager.state?.models?.[modelID]?.mesh as Mesh | undefined
      if (mesh) {
        mesh.updateMatrixWorld(true)
        const pos = new Vector3()
        const quat = new Quaternion()
        const scale = new Vector3()
        mesh.matrixWorld.decompose(pos, quat, scale)
        return { dx: pos.x, dy: pos.y, dz: pos.z }
      }
      const base = baseSubsetsRef.current.get(modelID)
      if (base) {
        base.updateMatrixWorld(true)
        const pos = new Vector3()
        const quat = new Quaternion()
        const scale = new Vector3()
        base.matrixWorld.decompose(pos, quat, scale)
        return { dx: pos.x, dy: pos.y, dz: pos.z }
      }
      return zeroOffset
    },
    [viewerRef]
  )

  const removePickable = useCallback((viewer: IfcViewerAPI, mesh: Mesh) => {
    const pickables = viewer.context.items.pickableIfcModels
    const index = pickables.indexOf(mesh as any)
    if (index !== -1) {
      pickables.splice(index, 1)
    }
  }, [])

  const registerPickable = useCallback(
    (viewer: IfcViewerAPI, mesh: Mesh, slot?: number) => {
      const pickables = viewer.context.items.pickableIfcModels
      if (typeof slot === 'number') {
        pickables[slot] = mesh as any
        return
      }
      if (!pickables.includes(mesh as any)) {
        pickables.push(mesh as any)
      }
    },
    []
  )

  const getExpressIdSet = useCallback(
    (modelID: number) => {
      const cached = expressIdCacheRef.current.get(modelID)
      if (cached && cached.size > 0) return cached

      const viewer = viewerRef.current
      const model = viewer?.IFC.loader.ifcManager.state?.models?.[modelID]?.mesh as Mesh | undefined
      const expressAttr = model?.geometry.getAttribute('expressID')
      if (!expressAttr || !('array' in expressAttr)) {
        // Model/geometry might not be ready yet. Do not cache empty permanently.
        return cached ?? new Set<number>()
      }

      const uniqueIds = new Set<number>()
      Array.from((expressAttr as { array: ArrayLike<number> }).array).forEach((rawId) => {
        if (typeof rawId === 'number') {
          uniqueIds.add(Math.trunc(rawId))
        }
      })

      if (uniqueIds.size > 0) {
        expressIdCacheRef.current.set(modelID, uniqueIds)
      } else if (!cached) {
        expressIdCacheRef.current.set(modelID, uniqueIds)
      }
      return uniqueIds
    },
    [viewerRef]
  )

  const getAllExpressIdsForModel = useCallback(
    (modelID: number) => {
      // Extract every expressID present in a model geometry
      const ids = getExpressIdSet(modelID)
      return ids.size > 0 ? Array.from(ids) : []
    },
    [getExpressIdSet]
  )

  const hasRenderableExpressId = useCallback(
    (modelID: number, expressID: number) => {
      return getExpressIdSet(modelID).has(expressID)
    },
    [getExpressIdSet]
  )

  const applyIfcSelectionHighlightSet = useCallback(
    (modelID: number, expressIDs: number[], anchorExpressID?: number | null) => {
      const viewer = viewerRef.current
      if (!viewer) return

      const renderableIds = normalizeIfcIds(expressIDs).filter((id) => hasRenderableExpressId(modelID, id))
      if (renderableIds.length === 0) {
        clearIfcSelectionHighlight(modelID)
        return
      }

      const primaryExpressID =
        typeof anchorExpressID === 'number' && Number.isFinite(anchorExpressID)
          ? Math.trunc(anchorExpressID)
          : renderableIds[0]

      const previous = highlightedIfcRef.current
      if (
        previous &&
        (previous.modelID !== modelID || !renderableIds.includes(previous.expressID))
      ) {
        clearIfcSelectionHighlight(previous.modelID)
      }

      const manager = viewer.IFC.loader.ifcManager
      const scene = viewer.context.getScene()
      const subset = manager.createSubset({
        modelID,
        ids: renderableIds,
        scene,
        removePrevious: true,
        material: getSelectionMaterial(),
        customID: getSelectionSubsetId(modelID)
      }) as Mesh | null

      if (!subset) {
        clearIfcSelectionHighlight(modelID)
        return
      }

      const key = getElementKey(modelID, primaryExpressID)
      const movedSubset = movedSubsetsRef.current.get(key)
      if (movedSubset) {
        subset.matrix.copy(movedSubset.matrix)
        subset.matrixAutoUpdate = false
      } else {
        const baseSubset = baseSubsetsRef.current.get(modelID)
        if (baseSubset) {
          subset.matrix.copy(baseSubset.matrix)
          subset.matrixAutoUpdate = false
        } else {
          const model = manager.state?.models?.[modelID]?.mesh as Mesh | undefined
          if (model) {
            subset.matrix.copy(model.matrix)
            subset.matrixAutoUpdate = false
          }
        }
      }

      subset.renderOrder = 10
      selectionSubsetsRef.current.set(modelID, subset)
      highlightedIfcRef.current = { modelID, expressID: primaryExpressID }
    },
    [
      clearIfcSelectionHighlight,
      getElementKey,
      getSelectionMaterial,
      getSelectionSubsetId,
      hasRenderableExpressId,
      viewerRef
    ]
  )

  const applyIfcSelectionHighlight = useCallback(
    (modelID: number, expressID: number) => {
      applyIfcSelectionHighlightSet(modelID, [expressID], expressID)
    },
    [applyIfcSelectionHighlightSet]
  )

  const highlightIfcGroup = useCallback(
    (modelID: number, expressIDs: number[], options?: { anchorExpressID?: number | null }) => {
      applyIfcSelectionHighlightSet(modelID, expressIDs, options?.anchorExpressID ?? null)
    },
    [applyIfcSelectionHighlightSet]
  )

  const getBaseCenter = useCallback(
    (modelID: number, expressID: number): Point3D | null => {
      const key = getElementKey(modelID, expressID)
      const cached = baseCentersRef.current.get(key)
      if (cached) {
        return cached
      }
      if (!hasRenderableExpressId(modelID, expressID)) {
        return null
      }
      const viewer = viewerRef.current
      if (!viewer) return null

      const manager = viewer.IFC.loader.ifcManager
      const scene = viewer.context.getScene()
      const customId = `base-center-${modelID}-${expressID}`
      const subset = manager.createSubset({
        modelID,
        ids: [expressID],
        scene,
        removePrevious: true,
        customID: customId
      }) as Mesh | null

      if (!subset) {
        return null
      }

      const cleanup = () => {
        scene.remove(subset)
        manager.removeSubset(modelID, undefined, customId)
      }

      subset.geometry.computeBoundingBox()
      const bbox = subset.geometry.boundingBox
      if (!bbox) {
        cleanup()
        return null
      }

      const center = new Vector3(
        (bbox.min.x + bbox.max.x) / 2,
        bbox.min.y,
        (bbox.min.z + bbox.max.z) / 2
      )
      subset.updateMatrixWorld(true)
      center.applyMatrix4(subset.matrixWorld)
      cleanup()

      const point = { x: center.x, y: center.y, z: center.z }
      baseCentersRef.current.set(key, point)
      return point
    },
    [getElementKey, hasRenderableExpressId, viewerRef]
  )

  const getElementWorldPosition = useCallback(
    (modelID: number, expressID: number): Point3D | null => {
      if (modelID === CUSTOM_CUBE_MODEL_ID) {
        const cube = cubeRegistryRef.current.get(expressID)
        return cube ? { x: cube.position.x, y: cube.position.y, z: cube.position.z } : null
      }
      const key = getElementKey(modelID, expressID)
      const baseCenter = getBaseCenter(modelID, expressID)
      if (!baseCenter) return null
      const offset = elementOffsetsRef.current.get(key)
      return offset
        ? { x: offset.dx, y: offset.dy, z: offset.dz }
        : { x: baseCenter.x, y: baseCenter.y, z: baseCenter.z }
    },
    [getBaseCenter, getElementKey]
  )

  const getIfcElementBasePosition = useCallback(
    (modelID: number, expressID: number): Point3D | null => {
      if (modelID === CUSTOM_CUBE_MODEL_ID) {
        const cube = cubeRegistryRef.current.get(expressID)
        return cube ? { x: cube.position.x, y: cube.position.y, z: cube.position.z } : null
      }
      const baseCenter = getBaseCenter(modelID, expressID)
      if (!baseCenter) return null
      return { x: baseCenter.x, y: baseCenter.y, z: baseCenter.z }
    },
    [getBaseCenter]
  )

  const getIfcElementTranslationDelta = useCallback(
    (modelID: number, expressID: number): Point3D | null => {
      if (modelID === CUSTOM_CUBE_MODEL_ID) {
        return null
      }
      const key = getElementKey(modelID, expressID)
      const offset = elementOffsetsRef.current.get(key)
      const baseCenter = getBaseCenter(modelID, expressID)
      if (!baseCenter) return null
      if (!offset) {
        return { x: 0, y: 0, z: 0 }
      }
      return {
        x: offset.dx - baseCenter.x,
        y: offset.dy - baseCenter.y,
        z: offset.dz - baseCenter.z
      }
    },
    [getBaseCenter, getElementKey]
  )

  const getIfcElementRotationDelta = useCallback(
    (modelID: number, expressID: number): Point3D | null => {
      if (modelID === CUSTOM_CUBE_MODEL_ID) {
        const cube = cubeRegistryRef.current.get(expressID)
        if (!cube) return null
        return {
          x: cube.rotation.x,
          y: cube.rotation.y,
          z: cube.rotation.z
        }
      }
      const key = getElementKey(modelID, expressID)
      const stored = elementRotationsRef.current.get(key)
      if (stored) {
        return { x: stored.x, y: stored.y, z: stored.z }
      }
      return { x: 0, y: 0, z: 0 }
    },
    [getElementKey]
  )

  const ensureBaseSubset = useCallback(
    (modelID: number) => {
      // Build one subset per model to hide originals and enable per-item offsets
      const viewer = viewerRef.current
      if (!viewer) return null
      if (baseSubsetsRef.current.has(modelID)) {
        return baseSubsetsRef.current.get(modelID) || null
      }

      const ids = getAllExpressIdsForModel(modelID)
      if (ids.length === 0) {
        return null
      }

      const manager = viewer.IFC.loader.ifcManager
      const model = manager.state?.models?.[modelID]?.mesh as Mesh | undefined
      const subset = manager.createSubset({
        modelID,
        ids,
        scene: viewer.context.getScene(),
        removePrevious: true,
        customID: BASE_SUBSET_ID
      }) as Mesh | null

      if (!subset || !model) {
        return null
      }

      subset.matrix.copy(model.matrix)
      subset.matrixAutoUpdate = false
      model.visible = false

      baseSubsetsRef.current.set(modelID, subset as Mesh)
      registerPickable(viewer, subset as Mesh, modelID)
      return subset as Mesh
    },
    [getAllExpressIdsForModel, registerPickable, viewerRef]
  )

  const getMovedIdsForModel = useCallback((modelID: number) => {
    const movedIds = new Set<number>()
    movedSubsetsRef.current.forEach((_subset, key) => {
      if (!key.startsWith(`${modelID}:`)) return
      const expressId = Number(key.split(':')[1])
      if (Number.isFinite(expressId)) {
        movedIds.add(expressId)
      }
    })
    return movedIds
  }, [])

  const updateSpaceBiasSubset = useCallback(
    (modelID: number, allowedIds: Set<number> | null) => {
      const viewer = viewerRef.current
      if (!viewer) return

      const manager = viewer.IFC.loader.ifcManager
      const scene = viewer.context.getScene()
      const targetIds = spaceBiasIdsRef.current.get(modelID)
      const existing = spaceBiasSubsetsRef.current.get(modelID)

      if (!targetIds || targetIds.size === 0) {
        if (existing) {
          scene.remove(existing)
          removePickable(viewer, existing)
          manager.removeSubset(modelID, undefined, getSpaceBiasSubsetId(modelID))
          spaceBiasSubsetsRef.current.delete(modelID)
        }
        return
      }

      const movedIds = getMovedIdsForModel(modelID)
      let idsToShow = Array.from(targetIds).filter((id) => !movedIds.has(id))
      if (allowedIds) {
        idsToShow = idsToShow.filter((id) => allowedIds.has(id))
      }

      if (idsToShow.length === 0) {
        if (existing) {
          scene.remove(existing)
          removePickable(viewer, existing)
          manager.removeSubset(modelID, undefined, getSpaceBiasSubsetId(modelID))
          spaceBiasSubsetsRef.current.delete(modelID)
        }
        return
      }

      if (existing) {
        scene.remove(existing)
        removePickable(viewer, existing)
      }

      const subset = manager.createSubset({
        modelID,
        ids: idsToShow,
        scene,
        removePrevious: true,
        customID: getSpaceBiasSubsetId(modelID)
      }) as Mesh | null

      if (!subset) return

      const baseSubset = baseSubsetsRef.current.get(modelID)
      if (baseSubset) {
        subset.matrix.copy(baseSubset.matrix)
        subset.matrixAutoUpdate = false
      }
      tuneSpaceBiasSubsetMesh(subset)
      spaceBiasSubsetsRef.current.set(modelID, subset)
      registerPickable(viewer, subset)
    },
    [getMovedIdsForModel, getSpaceBiasSubsetId, registerPickable, removePickable, viewerRef]
  )

  const configureSpaceBiasTargets = useCallback(
    (modelID: number, _expressIDs: number[]) => {
      const viewer = viewerRef.current
      if (!viewer) return
      if (!Number.isFinite(modelID)) return

      const baseSubset = ensureBaseSubset(modelID)
      if (!baseSubset) return
      const manager = viewer.IFC.loader.ifcManager

      const applied = spaceBiasAppliedRef.current.get(modelID) ?? new Set<number>()
      const restoreIds = Array.from(applied)
      if (restoreIds.length > 0) {
        const restored = manager.createSubset({
          modelID,
          ids: restoreIds,
          scene: viewer.context.getScene(),
          removePrevious: false,
          customID: BASE_SUBSET_ID
        }) as Mesh | null
        if (restored) {
          restored.matrix.copy(baseSubset.matrix)
          restored.matrixAutoUpdate = false
        }
      }

      spaceBiasIdsRef.current.delete(modelID)
      spaceBiasAppliedRef.current.delete(modelID)
      const activeFilter = filterIdsRef.current.get(modelID) ?? null
      updateSpaceBiasSubset(modelID, activeFilter)
    },
    [ensureBaseSubset, updateSpaceBiasSubset, viewerRef]
  )

  const clearOffsetArtifacts = useCallback(
    (modelID?: number | null) => {
      // Remove derived subsets and restore pickable originals
      const viewer = viewerRef.current
      if (!viewer) return

      const manager = viewer.IFC.loader.ifcManager
      const scene = viewer.context.getScene()
      const derivedIds = Array.from(
        new Set([
          ...baseSubsetsRef.current.keys(),
          ...spaceBiasSubsetsRef.current.keys(),
          ...selectionSubsetsRef.current.keys(),
          ...Array.from(movedSubsetsRef.current.keys())
            .map((key) => Number(key.split(':')[0]))
            .filter((id) => Number.isFinite(id))
        ])
      )
      const idsToClear = typeof modelID === 'number' ? [modelID] : derivedIds

      idsToClear.forEach((id) => {
        const filterSubset = filterSubsetsRef.current.get(id)
        if (filterSubset) {
          scene.remove(filterSubset)
          removePickable(viewer, filterSubset)
          manager.removeSubset(id, undefined, getFilterSubsetId(id))
          filterSubsetsRef.current.delete(id)
          filterIdsRef.current.delete(id)
        }
        const spaceBiasSubset = spaceBiasSubsetsRef.current.get(id)
        if (spaceBiasSubset) {
          scene.remove(spaceBiasSubset)
          removePickable(viewer, spaceBiasSubset)
          manager.removeSubset(id, undefined, getSpaceBiasSubsetId(id))
          spaceBiasSubsetsRef.current.delete(id)
        }
        const selectionSubset = selectionSubsetsRef.current.get(id)
        if (selectionSubset) {
          scene.remove(selectionSubset)
          manager.removeSubset(id, undefined, getSelectionSubsetId(id))
          selectionSubsetsRef.current.delete(id)
        }
        const movedKeys = Array.from(movedSubsetsRef.current.keys()).filter((key) =>
          key.startsWith(`${id}:`)
        )
        movedKeys.forEach((key) => {
          const moved = movedSubsetsRef.current.get(key)
          if (moved) {
            scene.remove(moved)
            removePickable(viewer, moved)
            manager.removeSubset(id, undefined, `${MOVED_SUBSET_PREFIX}${key}`)
          }
          movedSubsetsRef.current.delete(key)
          elementOffsetsRef.current.delete(key)
          elementRotationsRef.current.delete(key)
        })

        const baseSubset = baseSubsetsRef.current.get(id)
        if (baseSubset) {
          scene.remove(baseSubset)
          removePickable(viewer, baseSubset)
          manager.removeSubset(id, undefined, BASE_SUBSET_ID)
          baseSubsetsRef.current.delete(id)
        }

        const model = manager.state?.models?.[id]?.mesh as Mesh | undefined
        if (model) {
          model.visible = true
          registerPickable(viewer, model, id)
        }
        spaceBiasIdsRef.current.delete(id)
        spaceBiasAppliedRef.current.delete(id)
        hiddenIdsRef.current.delete(id)
        expressIdCacheRef.current.delete(id)
        Array.from(baseCentersRef.current.keys())
          .filter((key) => key.startsWith(`${id}:`))
          .forEach((key) => baseCentersRef.current.delete(key))
        if (highlightedIfcRef.current?.modelID === id) {
          highlightedIfcRef.current = null
        }
      })
      if (typeof modelID !== 'number') {
        baseCentersRef.current.clear()
        spaceBiasIdsRef.current.clear()
        spaceBiasAppliedRef.current.clear()
        hiddenIdsRef.current.clear()
        elementRotationsRef.current.clear()
        selectionSubsetsRef.current.clear()
        highlightedIfcRef.current = null
      }
    },
    [
      getFilterSubsetId,
      getSelectionSubsetId,
      getSpaceBiasSubsetId,
      registerPickable,
      removePickable,
      viewerRef
    ]
  )

  const updateVisibilityForModel = useCallback(
    (modelID: number, allowedIds: Set<number> | null) => {
      const viewer = viewerRef.current
      if (!viewer) return
      const manager = viewer.IFC.loader.ifcManager
      const scene = viewer.context.getScene()
      const movedIds = getMovedIdsForModel(modelID)
      const hiddenIds = hiddenIdsRef.current.get(modelID) ?? new Set<number>()

      const baseSubset = ensureBaseSubset(modelID)
      const modelMesh = manager.state?.models?.[modelID]?.mesh as Mesh | undefined
      const filterSubset = filterSubsetsRef.current.get(modelID)

      const effectiveAllowed =
        allowedIds === null
          ? hiddenIds.size === 0 && movedIds.size === 0
            ? null
            : new Set(getAllExpressIdsForModel(modelID).filter((id) => !hiddenIds.has(id)))
          : new Set(Array.from(allowedIds).filter((id) => !hiddenIds.has(id)))

      if (!effectiveAllowed) {
        if (filterSubset) {
          scene.remove(filterSubset)
          removePickable(viewer, filterSubset)
          manager.removeSubset(modelID, undefined, getFilterSubsetId(modelID))
          filterSubsetsRef.current.delete(modelID)
        }
        if (baseSubset) {
          baseSubset.visible = true
          registerPickable(viewer, baseSubset, modelID)
        } else if (modelMesh) {
          modelMesh.visible = true
        }
        movedSubsetsRef.current.forEach((subset, key) => {
          if (key.startsWith(`${modelID}:`)) {
            subset.visible = true
          }
        })
        updateSpaceBiasSubset(modelID, null)
        return
      }

      if (effectiveAllowed.size === 0) {
        if (filterSubset) {
          scene.remove(filterSubset)
          removePickable(viewer, filterSubset)
          manager.removeSubset(modelID, undefined, getFilterSubsetId(modelID))
          filterSubsetsRef.current.delete(modelID)
        }
        if (baseSubset) {
          baseSubset.visible = false
        } else if (modelMesh) {
          modelMesh.visible = false
        }
        movedSubsetsRef.current.forEach((subset, key) => {
          if (key.startsWith(`${modelID}:`)) {
            subset.visible = false
          }
        })
        updateSpaceBiasSubset(modelID, effectiveAllowed)
        return
      }

      if (baseSubset) {
        baseSubset.visible = false
      } else if (modelMesh) {
        modelMesh.visible = false
      }

      movedSubsetsRef.current.forEach((subset, key) => {
        if (!key.startsWith(`${modelID}:`)) return
        const expressId = Number(key.split(':')[1])
        if (Number.isFinite(expressId)) {
          subset.visible = effectiveAllowed.has(expressId)
        }
      })

      const idsToShow = Array.from(effectiveAllowed).filter((id) => !movedIds.has(id))
      if (idsToShow.length === 0) {
        if (filterSubset) {
          scene.remove(filterSubset)
          removePickable(viewer, filterSubset)
          manager.removeSubset(modelID, undefined, getFilterSubsetId(modelID))
          filterSubsetsRef.current.delete(modelID)
        }
        updateSpaceBiasSubset(modelID, effectiveAllowed)
        return
      }

      const subset = manager.createSubset({
        modelID,
        ids: idsToShow,
        scene,
        removePrevious: true,
        customID: getFilterSubsetId(modelID)
      }) as Mesh | null
      if (subset) {
        if (baseSubset) {
          subset.matrix.copy(baseSubset.matrix)
          subset.matrixAutoUpdate = false
        }
        filterSubsetsRef.current.set(modelID, subset as Mesh)
        registerPickable(viewer, subset as Mesh, modelID)
      }
      updateSpaceBiasSubset(modelID, effectiveAllowed)
    },
    [
      ensureBaseSubset,
      getFilterSubsetId,
      getAllExpressIdsForModel,
      getMovedIdsForModel,
      registerPickable,
      removePickable,
      updateSpaceBiasSubset,
      viewerRef
    ]
  )

  const applyVisibilityFilter = useCallback(
    (modelID: number, visibleIds: number[] | null) => {
      const allowed =
        visibleIds === null ? null : new Set(visibleIds.filter(Number.isFinite))
      filterIdsRef.current.set(modelID, allowed)
      updateVisibilityForModel(modelID, allowed)
    },
    [updateVisibilityForModel]
  )

  const normalizeIfcValue = useCallback((rawValue: any): string => {
    // Flatten IFC property shapes into strings for display
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
  }, [])

  const buildPropertyFields = useCallback(
    (rawProperties: any): PropertyField[] => {
      // Select a handful of readable properties and property sets for the panel
      if (!rawProperties) {
        return []
      }

      const fields: PropertyField[] = []
      const preferredKeys = [
        'GlobalId',
        'Name',
        'Description',
        'ObjectType',
        'PredefinedType',
        'Tag'
      ]

      const seenKeys = new Set<string>()
      const addField = (key: string, label: string, rawValue: any) => {
        const normalized = normalizeIfcValue(rawValue)
        if (normalized === '' && normalized !== rawValue) {
          return
        }
        const uniqueKey = seenKeys.has(key) ? `${key}-${seenKeys.size}` : key
        seenKeys.add(uniqueKey)
        fields.push({
          key: uniqueKey,
          label,
          value: normalized
        })
      }

      preferredKeys.forEach((key) => {
        if (rawProperties[key] !== undefined) {
          addField(key, key, rawProperties[key])
        }
      })

      Object.entries(rawProperties).forEach(([key, value]) => {
        if (preferredKeys.includes(key)) {
          return
        }
        if (
          typeof value === 'string' ||
          typeof value === 'number' ||
          typeof value === 'boolean'
        ) {
          addField(key, key, value)
        } else if (value && typeof value === 'object' && 'value' in value) {
          addField(key, key, value)
        }
      })

      if (Array.isArray(rawProperties.psets)) {
        rawProperties.psets.forEach((pset: any, psetIndex: number) => {
          const setName = normalizeIfcValue(pset?.Name) || `Property Set ${psetIndex + 1}`
          const properties = Array.isArray(pset?.HasProperties) ? pset.HasProperties : []
          properties.forEach((prop: any, propIndex: number) => {
            const propName = normalizeIfcValue(prop?.Name) || `Property ${propIndex + 1}`
            const propValue =
              prop?.NominalValue ??
              prop?.LengthValue ??
              prop?.AreaValue ??
              prop?.VolumeValue ??
              prop?.BooleanValue ??
              prop?.IntegerValue ??
              prop?.RealValue ??
              prop?.Value ??
              prop

            const key = `pset-${pset?.expressID ?? psetIndex}-${prop?.expressID ?? propIndex}`
            addField(key, `${setName} / ${propName}`, propValue)
          })
        })
      }

      return fields.slice(0, 60)
    },
    [normalizeIfcValue]
  )

  const fetchProperties = useCallback(
    async (modelID: number, expressID: number, focusPoint?: Point3D | null) => {
      // Guard against race conditions by tokenizing property requests
      const viewer = viewerRef.current
      if (!viewer) return

      const requestToken = ++propertyRequestRef.current
      setIsFetchingProperties(true)
      setPropertyError(null)

      try {
        // Recursive relation traversal can explode on large IFC graphs and freeze UI.
        // We only need direct attributes + property sets for the inspector panel.
        const properties = await viewer.IFC.getProperties(modelID, expressID, false, true)
        if (!properties) {
          throw new Error('No properties returned for this element.')
        }
        if (propertyRequestRef.current !== requestToken) {
          return
        }

        const resolvedType =
          typeof properties.ifcClass === 'string'
            ? properties.ifcClass
            : typeof properties.type === 'string'
              ? properties.type
              : typeof properties.type === 'number'
                ? String(properties.type)
                : undefined
        setSelectedElement({
          modelID,
          expressID,
          type: resolvedType
        })
        const key = getElementKey(modelID, expressID)
        const resolvedFocus = focusPoint ?? getElementWorldPosition(modelID, expressID)
        const currentCenter = getElementWorldPosition(modelID, expressID)
        if (resolvedFocus && currentCenter) {
          focusOffsetRef.current = {
            x: resolvedFocus.x - currentCenter.x,
            y: resolvedFocus.y - currentCenter.y,
            z: resolvedFocus.z - currentCenter.z
          }
        } else {
          focusOffsetRef.current = null
        }
        if (resolvedFocus) {
          setOffsetInputs({ dx: resolvedFocus.x, dy: resolvedFocus.y, dz: resolvedFocus.z })
        } else {
          const fallbackCenter =
            elementOffsetsRef.current.get(key) ??
            (() => {
              const baseCenter = getBaseCenter(modelID, expressID)
              if (!baseCenter) return getModelBaseOffset(modelID)
              return {
                dx: baseCenter.x,
                dy: baseCenter.y,
                dz: baseCenter.z
              }
            })()
          setOffsetInputs(fallbackCenter)
        }
        setPropertyFields(buildPropertyFields(properties))
      } catch (err) {
        if (propertyRequestRef.current !== requestToken) {
          return
        }
        console.error('Failed to load IFC properties', err)
        setPropertyError('Unable to load IFC properties for the selected element.')
        setSelectedElement((prev) => {
          if (prev && prev.modelID === modelID && prev.expressID === expressID) {
            return prev
          }
          return { modelID, expressID }
        })
        setPropertyFields([])
      } finally {
        if (propertyRequestRef.current === requestToken) {
          setIsFetchingProperties(false)
        }
      }
    },
    [buildPropertyFields, getElementKey, getElementWorldPosition, getModelBaseOffset, viewerRef]
  )

  const handleFieldChange = useCallback((key: string, value: string) => {
    setPropertyFields((prev) => prev.map((field) => (field.key === key ? { ...field, value } : field)))
  }, [])

  const handleOffsetInputChange = useCallback((axis: keyof OffsetVector, value: number) => {
    setOffsetInputs((prev) => ({
      ...prev,
      [axis]: Number.isFinite(value) ? value : 0
    }))
  }, [])

  const setCustomCubeRoomNumber = useCallback((expressID: number, roomNumber?: string | null) => {
    if (!Number.isFinite(expressID)) return
    if (!roomNumber) {
      customCubeRoomsRef.current.delete(expressID)
      return
    }
    customCubeRoomsRef.current.set(expressID, roomNumber)
  }, [])

  const ensureCustomCubesPickable = useCallback(() => {
    const viewer = viewerRef.current
    if (!viewer) return
    const pickables = viewer.context.items.pickableIfcModels
    cubeRegistryRef.current.forEach((cube) => {
      if (!pickables.includes(cube as any)) {
        pickables.push(cube as any)
      }
    })
  }, [viewerRef])

  const buildCubePropertyFields = useCallback(
    (expressID: number, pos?: Vector3 | null): PropertyField[] => {
      const fields: PropertyField[] = [
        { key: 'type', label: 'Type', value: 'CUBE' },
        { key: 'x', label: 'X', value: pos ? pos.x.toFixed(3) : '0' },
        { key: 'y', label: 'Y', value: pos ? pos.y.toFixed(3) : '0' },
        { key: 'z', label: 'Z', value: pos ? pos.z.toFixed(3) : '0' }
      ]
      const roomNumber = customCubeRoomsRef.current.get(expressID)
      if (roomNumber) {
        fields.push({ key: 'roomNumber', label: 'Room', value: roomNumber })
      }
      return fields
    },
    []
  )

  const getExpressIdFromHit = useCallback((hit: {
    object: Mesh
    face?: { a?: number }
    faceIndex?: number
  }): number | null => {
    const geometry = hit.object?.geometry as { getAttribute?: (name: string) => any; index?: any } | undefined
    const expressAttr = geometry?.getAttribute?.('expressID')
    if (!expressAttr || typeof expressAttr.getX !== 'function') {
      return null
    }

    let vertexIndex: number | undefined
    if (typeof hit.face?.a === 'number') {
      vertexIndex = hit.face.a
    } else if (typeof hit.faceIndex === 'number') {
      const indexAttr = geometry?.index
      if (indexAttr && typeof indexAttr.getX === 'function') {
        vertexIndex = indexAttr.getX(hit.faceIndex * 3)
      } else {
        vertexIndex = hit.faceIndex * 3
      }
    }

    if (typeof vertexIndex !== 'number') {
      return null
    }

    const rawId = expressAttr.getX(vertexIndex)
    return Number.isFinite(rawId) ? Math.trunc(rawId) : null
  }, [])

  const pickCandidatesAt = useCallback(
    (
      clientX: number,
      clientY: number,
      container: HTMLElement,
      maxDistance = 0.02
    ): PickCandidate[] => {
      const viewer = viewerRef.current
      if (!viewer) return []
      const rect = container.getBoundingClientRect()
      if (rect.width === 0 || rect.height === 0) return []

      const toNdc = (sampleX: number, sampleY: number) =>
        new Vector2(
          ((sampleX - rect.left) / rect.width) * 2 - 1,
          -((sampleY - rect.top) / rect.height) * 2 + 1
        )

      const collectSampleCandidates = (sampleX: number, sampleY: number): PickCandidate[] => {
        if (
          sampleX < rect.left ||
          sampleX > rect.right ||
          sampleY < rect.top ||
          sampleY > rect.bottom
        ) {
          return []
        }

        const ndc = toNdc(sampleX, sampleY)
        const raycaster = new Raycaster()
        raycaster.setFromCamera(ndc, viewer.context.getCamera())

        const cubeHits = raycaster.intersectObjects(Array.from(cubeRegistryRef.current.values()), true)
        const cubeCandidates: PickCandidate[] = []
        const localSeen = new Set<string>()
        for (const hit of cubeHits) {
          const hitObject: any = hit.object
          const modelID = hitObject?.modelID
          if (typeof modelID !== 'number') continue
          const expressID = getExpressIdFromHit(hit as any)
          if (expressID === null) continue
          const key = `${modelID}:${expressID}`
          if (localSeen.has(key)) continue
          localSeen.add(key)
          cubeCandidates.push({
            modelID,
            expressID,
            kind: 'custom',
            distance: hit.distance
          })
        }

        const ifcCandidates = viewer.context.castRayIfcCandidates(ndc).map((hit) => ({
          modelID: hit.modelID,
          expressID: hit.id,
          kind: 'ifc' as const,
          distance: hit.distance
        }))

        return [...cubeCandidates, ...ifcCandidates].sort((left, right) => left.distance - right.distance)
      }

      const addWithinLimit = (
        source: PickCandidate[],
        limit: number,
        target: PickCandidate[],
        seenKeys: Set<string>
      ) => {
        for (const candidate of source) {
          if (candidate.distance > limit) break
          const key = `${candidate.modelID}:${candidate.expressID}`
          if (seenKeys.has(key)) continue
          seenKeys.add(key)
          target.push(candidate)
        }
      }

      const centerCandidates = collectSampleCandidates(clientX, clientY)
      if (centerCandidates.length === 0) {
        const fallbackOffsets = [
          { x: -6, y: 0 },
          { x: 6, y: 0 },
          { x: 0, y: -6 },
          { x: 0, y: 6 },
          { x: -4, y: -4 },
          { x: 4, y: -4 },
          { x: -4, y: 4 },
          { x: 4, y: 4 }
        ]
        const fallbackResults: PickCandidate[] = []
        const fallbackSeen = new Set<string>()
        fallbackOffsets.forEach((offset) => {
          const local = collectSampleCandidates(clientX + offset.x, clientY + offset.y)
          if (local.length === 0) return
          addWithinLimit(local, local[0].distance + maxDistance, fallbackResults, fallbackSeen)
        })
        return fallbackResults
      }

      const results: PickCandidate[] = []
      const seenKeys = new Set<string>()
      const anchorDistance = centerCandidates[0].distance
      const centerLimit = anchorDistance + Math.max(maxDistance, anchorDistance * 0.02)
      addWithinLimit(centerCandidates, centerLimit, results, seenKeys)

      if (results.length > 1) {
        return results
      }

      const overlapOffsets = [
        { x: -6, y: 0 },
        { x: 6, y: 0 },
        { x: 0, y: -6 },
        { x: 0, y: 6 },
        { x: -4, y: -4 },
        { x: 4, y: -4 },
        { x: -4, y: 4 },
        { x: 4, y: 4 }
      ]
      const overlapLimit = anchorDistance + Math.max(maxDistance, anchorDistance * 0.02)

      overlapOffsets.forEach((offset) => {
        const local = collectSampleCandidates(clientX + offset.x, clientY + offset.y)
        if (local.length === 0) return
        addWithinLimit(local, overlapLimit, results, seenKeys)
      })

      return results
    },
    [getExpressIdFromHit, viewerRef]
  )

  const applyIfcElementTransform = useCallback(
    (
      modelID: number,
      expressID: number,
      targetOffset: OffsetVector,
      targetRotation?: Point3D | null
    ) => {
      const viewer = viewerRef.current
      if (!viewer) return
      if (!hasRenderableExpressId(modelID, expressID)) {
        return
      }

      const manager = viewer.IFC.loader.ifcManager
      const scene = viewer.context.getScene()
      const key = getElementKey(modelID, expressID)

      const baseSubset = ensureBaseSubset(modelID)
      if (!baseSubset) {
        return
      }

      const baseCenter = getBaseCenter(modelID, expressID)
      if (!baseCenter) {
        return
      }
      const resolvedRotation = normalizeRotation(targetRotation ?? elementRotationsRef.current.get(key))

      const previous = movedSubsetsRef.current.get(key)
      if (previous) {
        scene.remove(previous)
        removePickable(viewer, previous)
        manager.removeSubset(modelID, undefined, `${MOVED_SUBSET_PREFIX}${key}`)
        movedSubsetsRef.current.delete(key)
      }

      const isZeroOffset =
        Math.abs(targetOffset.dx - baseCenter.x) < COORD_EPSILON &&
        Math.abs(targetOffset.dy - baseCenter.y) < COORD_EPSILON &&
        Math.abs(targetOffset.dz - baseCenter.z) < COORD_EPSILON
      const hasRotation = !isZeroRotation(resolvedRotation)

      if (isZeroOffset && !hasRotation) {
        elementOffsetsRef.current.delete(key)
        elementRotationsRef.current.delete(key)
        const activeFilter = filterIdsRef.current.get(modelID) ?? null
        updateVisibilityForModel(modelID, activeFilter)
        const activeHighlight = highlightedIfcRef.current
        if (
          activeHighlight &&
          activeHighlight.modelID === modelID &&
          activeHighlight.expressID === expressID
        ) {
          applyIfcSelectionHighlight(modelID, expressID)
        }
        return
      }

      const moved = manager.createSubset({
        modelID,
        ids: [expressID],
        scene,
        removePrevious: true,
        customID: `${MOVED_SUBSET_PREFIX}${key}`
      }) as Mesh | null

      if (!moved) {
        return
      }

      const baseMatrix = new Matrix4()
      if (baseSubset) {
        baseMatrix.copy(baseSubset.matrix)
      } else {
        const modelMesh = manager.state?.models?.[modelID]?.mesh as Mesh | undefined
        if (modelMesh) {
          baseMatrix.copy(modelMesh.matrix)
        } else {
          baseMatrix.identity()
        }
      }

      const baseQuaternion = new Quaternion()
      const baseScale = new Vector3(1, 1, 1)
      baseMatrix.decompose(new Vector3(), baseQuaternion, baseScale)

      const baseInverse = new Matrix4().copy(baseMatrix).invert()
      const localPivot = new Vector3(baseCenter.x, baseCenter.y, baseCenter.z).applyMatrix4(baseInverse)

      const deltaQuat = new Quaternion().setFromEuler(
        new Euler(resolvedRotation.x, resolvedRotation.y, resolvedRotation.z, 'XYZ')
      )
      const worldQuaternion = deltaQuat.clone().multiply(baseQuaternion)
      const pivotOffset = localPivot.clone().multiply(baseScale).applyQuaternion(worldQuaternion)
      const targetCenter = new Vector3(targetOffset.dx, targetOffset.dy, targetOffset.dz)
      const resolvedPosition = targetCenter.clone().sub(pivotOffset)

      moved.quaternion.copy(worldQuaternion)
      moved.scale.copy(baseScale)
      moved.position.copy(resolvedPosition)
      moved.updateMatrix()
      moved.matrixAutoUpdate = false

      movedSubsetsRef.current.set(key, moved as Mesh)
      elementOffsetsRef.current.set(key, targetOffset)
      if (hasRotation) {
        elementRotationsRef.current.set(key, resolvedRotation)
      } else {
        elementRotationsRef.current.delete(key)
      }
      registerPickable(viewer, moved as Mesh)
      const activeFilter = filterIdsRef.current.get(modelID) ?? null
      updateVisibilityForModel(modelID, activeFilter)
      const activeHighlight = highlightedIfcRef.current
      if (activeHighlight && activeHighlight.modelID === modelID && activeHighlight.expressID === expressID) {
        applyIfcSelectionHighlight(modelID, expressID)
      }
    },
    [
      applyIfcSelectionHighlight,
      ensureBaseSubset,
      getBaseCenter,
      getElementKey,
      hasRenderableExpressId,
      isZeroRotation,
      normalizeRotation,
      registerPickable,
      removePickable,
      updateVisibilityForModel,
      viewerRef
    ]
  )

  const applyIfcElementOffset = useCallback(
    (modelID: number, expressID: number, targetOffset: OffsetVector) => {
      const key = getElementKey(modelID, expressID)
      applyIfcElementTransform(modelID, expressID, targetOffset, elementRotationsRef.current.get(key))
    },
    [applyIfcElementTransform, getElementKey]
  )

  const applyIfcElementRotation = useCallback(
    (modelID: number, expressID: number, targetRotation: Point3D) => {
      const center = getElementWorldPosition(modelID, expressID) ?? getBaseCenter(modelID, expressID)
      if (!center) return
      applyIfcElementTransform(
        modelID,
        expressID,
        { dx: center.x, dy: center.y, dz: center.z },
        targetRotation
      )
    },
    [applyIfcElementTransform, getBaseCenter, getElementWorldPosition]
  )

  const moveSelectedTo = useCallback(
    (targetOffset: OffsetVector) => {
      // Move cubes directly or rebuild IFC subsets so the element appears at the new offset
      const viewer = viewerRef.current
      if (!viewer || !selectedElement) return

      setOffsetInputs(targetOffset)

      if (selectedElement.modelID === CUSTOM_CUBE_MODEL_ID) {
        focusOffsetRef.current = null
        const key = `cube:${selectedElement.expressID}`
        const cube = cubeRegistryRef.current.get(selectedElement.expressID)
        if (cube) {
          cube.position.set(targetOffset.dx, targetOffset.dy, targetOffset.dz)
          cube.updateMatrix()
          cube.matrixAutoUpdate = false
          elementOffsetsRef.current.set(key, targetOffset)
        }
        return
      }

      const focusOffset = focusOffsetRef.current
      const adjustedTarget = focusOffset
        ? {
            dx: targetOffset.dx - focusOffset.x,
            dy: targetOffset.dy - focusOffset.y,
            dz: targetOffset.dz - focusOffset.z
          }
        : targetOffset

      applyIfcElementOffset(selectedElement.modelID, selectedElement.expressID, adjustedTarget)
    },
    [
      applyIfcElementOffset,
      selectedElement,
      viewerRef
    ]
  )

  const applyOffsetToSelectedElement = useCallback(() => {
    moveSelectedTo(offsetInputs)
  }, [moveSelectedTo, offsetInputs])

  const handlePick = useCallback(async (options?: { autoFocus?: boolean; allowedIfcTypes?: string[] }) => {
    const viewer = viewerRef.current
    if (!viewer) {
      return
    }

    try {
      const shouldAutoFocus = options?.autoFocus ?? false
      const camera = viewer.context.getCamera()
      const pointer = viewer.context.mouse.position
      const raycaster = new Raycaster()
      raycaster.setFromCamera(pointer, camera)
      const cubeMeshes = Array.from(cubeRegistryRef.current.values())
      const cubeHit = cubeMeshes.length ? raycaster.intersectObjects(cubeMeshes, true)[0] : undefined
      const ifcHit = viewer.context.castRayIfc()
      const resolvedHit =
        cubeHit && (!ifcHit || cubeHit.distance <= ifcHit.distance) ? cubeHit : ifcHit
      const hitObject: any = resolvedHit?.object

      if (resolvedHit && hitObject?.modelID === CUSTOM_CUBE_MODEL_ID) {
        clearIfcSelectionHighlight()
        viewer.IFC.selector.unpickIfcItems()
        const hitExpressId = getExpressIdFromHit(resolvedHit as any) ?? cubeIdCounterRef.current

        const key = `cube:${hitExpressId}`
        setSelectedElement({ modelID: CUSTOM_CUBE_MODEL_ID, expressID: hitExpressId, type: 'CUBE' })
        const cube = cubeRegistryRef.current.get(hitExpressId)
        const pos = cube?.position
        setOffsetInputs(pos ? { dx: pos.x, dy: pos.y, dz: pos.z } : zeroOffset)
        setPropertyFields(buildCubePropertyFields(hitExpressId, pos))
        elementOffsetsRef.current.set(key, pos ? { dx: pos.x, dy: pos.y, dz: pos.z } : zeroOffset)
        setCubeHighlight(hitExpressId)
        return
      }

      setCubeHighlight(null)

      const picked = await viewer.IFC.selector.pickIfcItem(false)
      if (!picked || picked.id === undefined || picked.modelID === undefined) {
        viewer.IFC.selector.unpickIfcItems()
        resetSelection()
        return
      }

      const isAllowed = await isIfcSelectionAllowed(viewer, picked.modelID, picked.id, options)
      if (!isAllowed) {
        viewer.IFC.selector.unpickIfcItems()
        resetSelection()
        return
      }

      viewer.IFC.selector.unpickIfcItems()
      applyIfcSelectionHighlight(picked.modelID, picked.id)
      setSelectedElement({ modelID: picked.modelID, expressID: picked.id })
      setPropertyError(null)
      const focusPoint = shouldAutoFocus
        ? picked.point
          ? { x: picked.point.x, y: picked.point.y, z: picked.point.z }
          : getElementWorldPosition(picked.modelID, picked.id)
        : null
      if (shouldAutoFocus && focusPoint) {
        focusOnPoint(focusPoint)
      }
      void fetchProperties(picked.modelID, picked.id, focusPoint)
    } catch (err) {
      console.error('Failed to pick IFC item', err)
      resetSelection()
    }
  }, [
    fetchProperties,
    applyIfcSelectionHighlight,
    clearIfcSelectionHighlight,
    focusOnPoint,
    getElementWorldPosition,
    getExpressIdFromHit,
    isIfcSelectionAllowed,
    resetSelection,
    setCubeHighlight,
    viewerRef
  ])

  const selectById = useCallback(
    async (
      modelID: number,
      expressID: number,
      options?: { autoFocus?: boolean; allowedIfcTypes?: string[] }
    ) => {
      const viewer = viewerRef.current
      if (!viewer) return null
      try {
        const isAllowed = await isIfcSelectionAllowed(viewer, modelID, expressID, options)
        if (!isAllowed) {
          viewer.IFC.selector.unpickIfcItems()
          resetSelection()
          return null
        }

        const isRenderable = hasRenderableExpressId(modelID, expressID)
        const shouldAutoFocus = options?.autoFocus ?? false
        viewer.IFC.selector.unpickIfcItems()
        setSelectedElement({ modelID, expressID })
        setPropertyError(null)
        if (isRenderable) {
          applyIfcSelectionHighlight(modelID, expressID)
        } else {
          clearIfcSelectionHighlight(modelID)
        }
        const focusPoint =
          shouldAutoFocus && isRenderable ? getElementWorldPosition(modelID, expressID) : null
        void fetchProperties(modelID, expressID, focusPoint)
        const elementCenter = getElementWorldPosition(modelID, expressID)
        const resolvedPoint = shouldAutoFocus ? (focusPoint ?? elementCenter) : elementCenter
        const selectionPoint = resolvedPoint
          ? resolvedPoint
          : (() => {
              const fallbackOffset =
                elementOffsetsRef.current.get(getElementKey(modelID, expressID)) ??
                (() => {
                  const baseCenter = getBaseCenter(modelID, expressID)
                  if (!baseCenter) return getModelBaseOffset(modelID)
                  return {
                    dx: baseCenter.x,
                    dy: baseCenter.y,
                    dz: baseCenter.z
                  }
                })()
              return { x: fallbackOffset.dx, y: fallbackOffset.dy, z: fallbackOffset.dz }
            })()
        if (shouldAutoFocus && selectionPoint) {
          focusOnPoint(selectionPoint)
        }
        return selectionPoint
      } catch (err) {
        console.error('Failed to select IFC item by id', err)
      }
      return null
    },
    [
      applyIfcSelectionHighlight,
      clearIfcSelectionHighlight,
      fetchProperties,
      getElementKey,
      focusOnPoint,
      getElementWorldPosition,
      getModelBaseOffset,
      hasRenderableExpressId,
      isIfcSelectionAllowed,
      resetSelection,
      viewerRef
    ]
  )

  const rotateSelectedTo = useCallback(
    (targetRotation: Point3D) => {
      const viewer = viewerRef.current
      if (!viewer || !selectedElement) return
      const normalized = normalizeRotation(targetRotation)

      if (selectedElement.modelID === CUSTOM_CUBE_MODEL_ID) {
        const cube = cubeRegistryRef.current.get(selectedElement.expressID)
        if (!cube) return
        cube.rotation.set(normalized.x, normalized.y, normalized.z)
        cube.updateMatrix()
        cube.matrixAutoUpdate = false
        return
      }

      const center =
        getElementWorldPosition(selectedElement.modelID, selectedElement.expressID) ??
        getBaseCenter(selectedElement.modelID, selectedElement.expressID)
      if (!center) return
      applyIfcElementTransform(
        selectedElement.modelID,
        selectedElement.expressID,
        { dx: center.x, dy: center.y, dz: center.z },
        normalized
      )
    },
    [
      applyIfcElementTransform,
      getBaseCenter,
      getElementWorldPosition,
      normalizeRotation,
      selectedElement,
      viewerRef
    ]
  )

  const hideIfcElement = useCallback(
    (modelID: number, expressID: number) => {
      const viewer = viewerRef.current
      if (!viewer) return
      // Soft delete: keep subset/material graph intact and hide via visibility filtering.
      ensureBaseSubset(modelID)
      const manager = viewer.IFC.loader.ifcManager
      const scene = viewer.context.getScene()
      const key = getElementKey(modelID, expressID)

      let hidden = hiddenIdsRef.current.get(modelID)
      if (!hidden) {
        hidden = new Set<number>()
        hiddenIdsRef.current.set(modelID, hidden)
      }
      hidden.add(expressID)

      const moved = movedSubsetsRef.current.get(key)
      if (moved) {
        scene.remove(moved)
        removePickable(viewer, moved)
        manager.removeSubset(modelID, undefined, `${MOVED_SUBSET_PREFIX}${key}`)
        movedSubsetsRef.current.delete(key)
      }
      elementOffsetsRef.current.delete(key)
      elementRotationsRef.current.delete(key)
      spaceBiasIdsRef.current.get(modelID)?.delete(expressID)
      spaceBiasAppliedRef.current.get(modelID)?.delete(expressID)
      const activeFilter = filterIdsRef.current.get(modelID) ?? null
      updateVisibilityForModel(modelID, activeFilter)
      const activeHighlight = highlightedIfcRef.current
      if (activeHighlight && activeHighlight.modelID === modelID && activeHighlight.expressID === expressID) {
        clearIfcSelectionHighlight(modelID)
      }
    },
    [
      clearIfcSelectionHighlight,
      ensureBaseSubset,
      getElementKey,
      removePickable,
      updateVisibilityForModel,
      viewerRef
    ]
  )

  const selectCustomCube = useCallback(
    (expressID: number) => {
      const cube = cubeRegistryRef.current.get(expressID)
      if (!cube) return
      clearIfcSelectionHighlight()
      viewerRef.current?.IFC.selector.unpickIfcItems()
      const pos = cube.position
      setSelectedElement({ modelID: CUSTOM_CUBE_MODEL_ID, expressID, type: 'CUBE' })
      setOffsetInputs({ dx: pos.x, dy: pos.y, dz: pos.z })
      setPropertyFields(buildCubePropertyFields(expressID, pos))
      setPropertyError(null)
      setIsFetchingProperties(false)
      setCubeHighlight(expressID)
    },
    [buildCubePropertyFields, clearIfcSelectionHighlight, setCubeHighlight, viewerRef]
  )

  const clearIfcHighlight = useCallback(() => {
    clearIfcSelectionHighlight()
    viewerRef.current?.IFC.selector.unpickIfcItems()
  }, [clearIfcSelectionHighlight, viewerRef])

  const removeCustomCube = useCallback(
    (expressID: number) => {
      const viewer = viewerRef.current
      const cube = cubeRegistryRef.current.get(expressID)
      if (!viewer || !cube) return
      const scene = viewer.context.getScene()
      scene.remove(cube)
      removePickable(viewer, cube)
      cubeRegistryRef.current.delete(expressID)
      if (highlightedCubeRef.current === expressID) {
        highlightedCubeRef.current = null
      }
    },
    [removePickable, viewerRef]
  )

  const spawnCubeAt = useCallback(
    (target?: Point3D | null, id?: number): SpawnedCubeInfo | null => {
      const viewer = viewerRef.current
      if (!viewer) return null

      const scene = viewer.context.getScene()
      const geometry = new BoxGeometry(1, 1, 1)
      const material = new MeshStandardMaterial({
        color: CUBE_BASE_COLOR,
        metalness: 0.1,
        roughness: 0.8
      })
      const cube = new Mesh(geometry, material)

      const position = target ?? { x: 0, y: 0, z: 0 }
      cube.position.set(position.x, position.y, position.z)

      const resolvedId =
        typeof id === 'number' && Number.isFinite(id) && id > 0
          ? Math.trunc(id)
          : cubeIdCounterRef.current++
      if (resolvedId >= cubeIdCounterRef.current) {
        cubeIdCounterRef.current = resolvedId + 1
      }
      const existing = cubeRegistryRef.current.get(resolvedId)
      if (existing) {
        existing.position.set(position.x, position.y, position.z)
        existing.updateMatrix()
        existing.matrixAutoUpdate = false
        return { expressID: resolvedId, position }
      }
      const cubeExpressId = resolvedId
      const positionAttr = cube.geometry.getAttribute('position')
      const vertexCount = positionAttr ? positionAttr.count : 0
      const ids = new Float32Array(vertexCount)
      ids.fill(cubeExpressId)
      cube.geometry.setAttribute('expressID', new Float32BufferAttribute(ids, 1))
      ;(cube as any).modelID = CUSTOM_CUBE_MODEL_ID

      cubeRegistryRef.current.set(cubeExpressId, cube)
      scene.add(cube)
      viewer.context.items.pickableIfcModels.push(cube as any)

      return { expressID: cubeExpressId, position }
    },
    [viewerRef]
  )

  const spawnCube = useCallback(
    (target?: Point3D | null, options?: SpawnCubeOptions): SpawnedCubeInfo | null => {
      // Convenience wrapper that also focuses the camera if requested
      const info = spawnCubeAt(target, options?.id)
      if (options?.focus && info) {
        focusOnPoint(info.position)
      }
      return info
    },
    [focusOnPoint, spawnCubeAt]
  )

  const spawnUploadedModel = useCallback(
    async (
      file: File,
      target?: Point3D | null,
      options?: { focus?: boolean }
    ): Promise<SpawnedModelInfo | null> => {
      const viewer = viewerRef.current
      if (!viewer) return null
      try {
        const resolved = target || { x: 0, y: 0, z: 0 }
        await viewer.IFC.applyWebIfcConfig({
          COORDINATE_TO_ORIGIN: true,
          USE_FAST_BOOLS: false
        })
        const model = (await viewer.IFC.loadIfc(file, false)) as Mesh | undefined
        if (model) {
          tuneIfcModelMaterials(model)
          const serialized = serializeMeshGeometry(model)
          model.position.set(
            resolved.x - serialized.center.x,
            resolved.y - serialized.center.y,
            resolved.z - serialized.center.z
          )
          model.updateMatrix()
          model.updateMatrixWorld(true)
          if (options?.focus) {
            focusOnPoint(resolved)
          }
          const modelId = (model as { modelID?: number }).modelID
          if (typeof modelId === 'number') {
            return { modelID: modelId, position: resolved, geometry: serialized.geometry }
          }
        }
      } catch (err) {
        console.error('Failed to load uploaded model', err)
      }
      return null
    },
    [focusOnPoint, viewerRef]
  )

  return {
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
    highlightIfcGroup,
    hasRenderableExpressId,
    removeCustomCube,
    getIfcElementBasePosition,
    getIfcElementTranslationDelta,
    getIfcElementRotationDelta,
    getElementWorldPosition,
    moveSelectedTo,
    hideIfcElement,
    setCustomCubeRoomNumber,
    ensureCustomCubesPickable,
    pickCandidatesAt,
    getSelectedWorldPosition,
    resetSelection,
    clearOffsetArtifacts,
    spawnCube,
    spawnUploadedModel,
    applyIfcElementOffset,
    applyIfcElementRotation,
    rotateSelectedTo,
    applyVisibilityFilter,
    configureSpaceBiasTargets
  }
}
