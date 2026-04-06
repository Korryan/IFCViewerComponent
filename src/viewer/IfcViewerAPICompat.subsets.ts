import { BufferGeometry, Material, Mesh, MeshLambertMaterial, Object3D, Scene } from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { uniqueNumbers } from './IfcViewerAPICompat.materials'

export type GeometrySliceRecord = {
  geometry: BufferGeometry
  material: Material | Material[]
}

export type ViewerSubsetRecord = {
  ids: Set<number>
  mesh: Mesh
}

export type ViewerModelSubsetRecordLike = {
  numericId: number
  expressIds: Set<number>
  geometryCache: Map<number, GeometrySliceRecord[]>
  subsets: Map<string, ViewerSubsetRecord>
}

// Builds a merged Three.js mesh for the requested express ids from one cached model geometry map.
export const buildMeshFromCache = (args: {
  record: ViewerModelSubsetRecordLike
  ids: number[]
  materialOverride?: Material | Material[]
  tagModelObject: (root: Object3D, modelID: number) => void
}) => {
  const geometries: BufferGeometry[] = []
  const entryMaterials: Material[] = []

  const uniqueIds = uniqueNumbers(args.ids)
  for (const id of uniqueIds) {
    const entries = args.record.geometryCache.get(id)
    if (!entries || entries.length === 0) continue

    for (const entry of entries) {
      const geometry = entry.geometry.clone()
      const positions = geometry.getAttribute('position')
      if (!positions) {
        geometry.dispose()
        continue
      }

      if (!args.materialOverride) {
        const sourceMaterial = entry.material
        const indexCount = geometry.index ? geometry.index.count : positions.count

        if (Array.isArray(sourceMaterial)) {
          if (sourceMaterial.length === 0) {
            geometry.dispose()
            continue
          }

          const baseIndex = entryMaterials.length
          entryMaterials.push(...sourceMaterial)

          if (geometry.groups.length === 0) {
            geometry.clearGroups()
            geometry.addGroup(0, indexCount, baseIndex)
          } else {
            for (const group of geometry.groups) {
              const rawIndex = group.materialIndex
              const nextIndex =
                typeof rawIndex === 'number' && Number.isFinite(rawIndex) ? Math.trunc(rawIndex) : 0
              const clampedIndex = Math.max(0, Math.min(sourceMaterial.length - 1, nextIndex))
              group.materialIndex = baseIndex + clampedIndex
            }
          }
        } else {
          const baseIndex = entryMaterials.length
          entryMaterials.push(sourceMaterial)

          if (geometry.groups.length === 0) {
            geometry.clearGroups()
            geometry.addGroup(0, indexCount, baseIndex)
          } else {
            for (const group of geometry.groups) {
              group.materialIndex = baseIndex
            }
          }
        }
      } else {
        geometry.clearGroups()
      }
      geometries.push(geometry)
    }
  }

  if (geometries.length === 0) {
    return null
  }

  const merged = mergeGeometries(geometries, true)
  geometries.forEach((geometry) => geometry.dispose())
  if (!merged) {
    return null
  }

  const fallbackMaterial = new MeshLambertMaterial({ color: 0xffffff })
  const material =
    args.materialOverride ??
    (entryMaterials.length === 0
      ? fallbackMaterial
      : entryMaterials.length === 1
        ? entryMaterials[0]
        : entryMaterials)

  const mesh = new Mesh(merged, material)
  ;(mesh as any).modelID = args.record.numericId
  mesh.matrixAutoUpdate = false
  mesh.updateMatrix()
  args.tagModelObject(mesh, args.record.numericId)
  return mesh
}

// Removes one stored subset mesh from the scene graph and from the pickable registry.
export const detachSubsetRecord = (args: {
  record: ViewerModelSubsetRecordLike
  subsetId: string
  removePickable: (object: Object3D) => void
}) => {
  const subset = args.record.subsets.get(args.subsetId)
  if (!subset) return

  args.removePickable(subset.mesh)
  subset.mesh.parent?.remove(subset.mesh)
  subset.mesh.geometry?.dispose?.()
  args.record.subsets.delete(args.subsetId)
}

// Creates or rebuilds one subset mesh for the requested ids and stores it back on the model record.
export const createSubsetRecord = (args: {
  record: ViewerModelSubsetRecordLike
  subsetId: string
  ids: number[]
  scene: Scene
  removePrevious?: boolean
  material?: Material | Material[]
  addPickable: (object: Object3D) => void
  removePickable: (object: Object3D) => void
  tagModelObject: (root: Object3D, modelID: number) => void
}) => {
  const existing = args.record.subsets.get(args.subsetId)
  const requestedIds = uniqueNumbers(args.ids.filter((id) => args.record.expressIds.has(id)))
  if (requestedIds.length === 0) {
    if (existing) {
      detachSubsetRecord({
        record: args.record,
        subsetId: args.subsetId,
        removePickable: args.removePickable
      })
    }
    return null
  }

  const ids = new Set<number>(requestedIds)
  if (existing && args.removePrevious === false) {
    existing.ids.forEach((id) => ids.add(id))
  }

  if (existing) {
    detachSubsetRecord({
      record: args.record,
      subsetId: args.subsetId,
      removePickable: args.removePickable
    })
  }

  const subsetMesh = buildMeshFromCache({
    record: args.record,
    ids: Array.from(ids),
    materialOverride: args.material,
    tagModelObject: args.tagModelObject
  })
  if (!subsetMesh) return null

  args.scene.add(subsetMesh)
  args.addPickable(subsetMesh)
  args.record.subsets.set(args.subsetId, {
    ids,
    mesh: subsetMesh
  })
  return subsetMesh
}

// Removes ids from an existing subset and rebuilds the remaining subset with correct material group indices.
export const removeIdsFromSubsetRecord = (args: {
  record: ViewerModelSubsetRecordLike
  subsetId: string
  ids: number[]
  fallbackScene: Scene
  addPickable: (object: Object3D) => void
  removePickable: (object: Object3D) => void
  tagModelObject: (root: Object3D, modelID: number) => void
}) => {
  const subset = args.record.subsets.get(args.subsetId)
  if (!subset) return

  const nextIds = new Set<number>(subset.ids)
  uniqueNumbers(args.ids).forEach((id) => nextIds.delete(id))

  const targetScene = (subset.mesh.parent as Scene | null) ?? args.fallbackScene
  detachSubsetRecord({
    record: args.record,
    subsetId: args.subsetId,
    removePickable: args.removePickable
  })

  if (nextIds.size === 0) {
    return
  }

  const rebuilt = buildMeshFromCache({
    record: args.record,
    ids: Array.from(nextIds),
    tagModelObject: args.tagModelObject
  })
  if (!rebuilt) return

  targetScene.add(rebuilt)
  args.addPickable(rebuilt)
  args.record.subsets.set(args.subsetId, {
    ids: nextIds,
    mesh: rebuilt
  })
}
