import {
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshStandardMaterial
} from 'three'
import type { FurnitureGeometry, Point3D } from '../ifcViewerTypes'
import { CUSTOM_CUBE_MODEL_ID } from './selectionOffsets.shared'

// Tags every vertex in a custom geometry with the custom express id used for picking.
const tagCustomGeometryExpressId = (geometry: BufferGeometry, expressID: number) => {
  const positionAttr = geometry.getAttribute('position')
  const vertexCount = positionAttr ? positionAttr.count : 0
  if (vertexCount <= 0) return
  const ids = new Float32Array(vertexCount)
  ids.fill(expressID)
  geometry.setAttribute('expressID', new Float32BufferAttribute(ids, 1))
}

// Serializes a mesh hierarchy into centered geometry data suitable for persistence.
export const serializeMeshGeometry = (
  mesh: Mesh
): { geometry: FurnitureGeometry | null; center: Point3D } => {
  mesh.updateMatrixWorld(true)

  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let minZ = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  let maxZ = Number.NEGATIVE_INFINITY
  const worldPositions: number[] = []
  const serializedIndices: number[] = []
  let vertexOffset = 0

  mesh.traverse((node) => {
    const candidate = node as Mesh & { isMesh?: boolean }
    if (!candidate?.isMesh) return

    const sourceGeometry = candidate.geometry as BufferGeometry | undefined
    if (!sourceGeometry) return

    const geometry = sourceGeometry.clone()
    geometry.applyMatrix4(candidate.matrixWorld)

    const positions = geometry.getAttribute('position')
    if (!positions || typeof positions.getX !== 'function') {
      geometry.dispose()
      return
    }

    for (let index = 0; index < positions.count; index += 1) {
      const x = Number(positions.getX(index))
      const y = Number(positions.getY(index))
      const z = Number(positions.getZ(index))
      worldPositions.push(x, y, z)
      if (x < minX) minX = x
      if (y < minY) minY = y
      if (z < minZ) minZ = z
      if (x > maxX) maxX = x
      if (y > maxY) maxY = y
      if (z > maxZ) maxZ = z
    }

    const indexAttr = geometry.index
    if (indexAttr && typeof indexAttr.getX === 'function') {
      for (let index = 0; index < indexAttr.count; index += 1) {
        serializedIndices.push(vertexOffset + Math.trunc(indexAttr.getX(index)))
      }
    } else {
      for (let index = 0; index < positions.count; index += 1) {
        serializedIndices.push(vertexOffset + index)
      }
    }

    vertexOffset += positions.count
    geometry.dispose()
  })

  if (worldPositions.length < 9 || serializedIndices.length < 3) {
    return {
      geometry: null,
      center: { x: 0, y: 0, z: 0 }
    }
  }

  const center = {
    x: Number.isFinite(minX) && Number.isFinite(maxX) ? (minX + maxX) * 0.5 : 0,
    y: Number.isFinite(minY) && Number.isFinite(maxY) ? (minY + maxY) * 0.5 : 0,
    z: Number.isFinite(minZ) && Number.isFinite(maxZ) ? (minZ + maxZ) * 0.5 : 0
  }

  const serializedPositions: number[] = []
  for (let index = 0; index < worldPositions.length; index += 3) {
    serializedPositions.push(
      Number(worldPositions[index] - center.x),
      Number(worldPositions[index + 1] - center.y),
      Number(worldPositions[index + 2] - center.z)
    )
  }

  return {
    geometry: {
      positions: serializedPositions,
      indices: serializedIndices
    },
    center
  }
}

// Clones a loaded mesh hierarchy into one centered custom object rooted at its bounding-box center.
export const buildCenteredCustomObject = (
  source: Mesh,
  center: Point3D,
  expressID: number
): Group | null => {
  source.updateMatrixWorld(true)
  const root = new Group()
  let meshCount = 0

  source.traverse((candidate) => {
    const mesh = candidate as Mesh & {
      geometry?: BufferGeometry
      material?: MeshStandardMaterial | MeshStandardMaterial[]
      isMesh?: boolean
    }
    if (!mesh?.isMesh || !mesh.geometry) return

    const geometry = mesh.geometry.clone()
    geometry.applyMatrix4(mesh.matrixWorld)
    geometry.translate(-center.x, -center.y, -center.z)
    tagCustomGeometryExpressId(geometry, expressID)

    const material = Array.isArray(mesh.material)
      ? mesh.material.map((entry) => entry?.clone?.() ?? entry)
      : mesh.material?.clone?.() ?? mesh.material

    const clone = new Mesh(geometry, material as MeshStandardMaterial | MeshStandardMaterial[])
    ;(clone as any).modelID = CUSTOM_CUBE_MODEL_ID
    root.add(clone)
    meshCount += 1
  })

  if (meshCount === 0) {
    return null
  }

  root.position.set(center.x, center.y, center.z)
  ;(root as any).modelID = CUSTOM_CUBE_MODEL_ID
  return root
}

// Rebuilds a custom object group from geometry persisted in saved state.
export const buildCustomObjectFromStoredGeometry = (
  storedGeometry: FurnitureGeometry,
  expressID: number
): Group | null => {
  if (!Array.isArray(storedGeometry.positions) || storedGeometry.positions.length < 3) {
    return null
  }

  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(storedGeometry.positions, 3))
  if (Array.isArray(storedGeometry.indices) && storedGeometry.indices.length >= 3) {
    geometry.setIndex(storedGeometry.indices.map((value) => Math.trunc(Number(value))))
  }
  geometry.computeVertexNormals()
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  tagCustomGeometryExpressId(geometry, expressID)

  const material = new MeshStandardMaterial({
    color: 0xb8b8b8,
    metalness: 0.1,
    roughness: 0.8
  })

  const mesh = new Mesh(geometry, material)
  ;(mesh as any).modelID = CUSTOM_CUBE_MODEL_ID

  const root = new Group()
  root.add(mesh)
  ;(root as any).modelID = CUSTOM_CUBE_MODEL_ID
  return root
}
