import type { BufferGeometry, Intersection, Object3D, PerspectiveCamera, Raycaster, Vector2, Vector3 } from 'three'

export type PickResult = {
  id: number
  modelID: number
  point: Vector3
  distance: number
  object: Object3D
}

// Walks up the object tree to find the nearest numeric model id assigned to the hit object.
export const resolveModelID = (object: Object3D | null): number | null => {
  let current: any = object
  while (current) {
    if (typeof current.modelID === 'number') return current.modelID
    current = current.parent
  }
  return null
}

// Resolves an express id from indexed or non-indexed IFC geometry using one raycast hit.
export const getExpressIdFromGeometry = (geometry: BufferGeometry, faceIndex: number): number => {
  const expressAttr: any = geometry.getAttribute('expressID')
  if (!expressAttr || typeof expressAttr.getX !== 'function') {
    return -1
  }

  const indexAttr: any = geometry.index
  let vertexIndex = faceIndex * 3
  if (indexAttr && typeof indexAttr.getX === 'function') {
    vertexIndex = indexAttr.getX(faceIndex * 3)
  }

  const resolved = expressAttr.getX(vertexIndex)
  return Number.isFinite(resolved) ? Math.trunc(resolved) : -1
}

// Resolves the IFC express id represented by one raycast intersection.
export const resolveExpressID = (_modelID: number, hit: Intersection<Object3D>): number => {
  const object: any = hit.object
  const geometry: any = object?.geometry
  const faceIndex = typeof hit.faceIndex === 'number' ? hit.faceIndex : null

  const expressAttr = geometry?.getAttribute?.('expressID')
  if (!expressAttr || typeof expressAttr.getX !== 'function') {
    return -1
  }

  const indexAttr = geometry?.index
  let vertexIndex = faceIndex !== null ? faceIndex * 3 : 0
  if (indexAttr && typeof indexAttr.getX === 'function' && faceIndex !== null) {
    vertexIndex = indexAttr.getX(faceIndex * 3)
  }

  const raw = expressAttr.getX(vertexIndex)
  return Number.isFinite(raw) ? Math.trunc(raw) : -1
}

// Casts a ray into the current pickable objects and returns deduplicated IFC hit candidates.
export const castRayIfcCandidates = (args: {
  raycaster: Raycaster
  pointer: Vector2
  camera: PerspectiveCamera
  pickables: Object3D[]
}) => {
  const pickables = args.pickables.filter((entry): entry is Object3D => Boolean(entry))
  if (pickables.length === 0) return []
  args.raycaster.setFromCamera(args.pointer, args.camera)
  const hits = args.raycaster.intersectObjects(pickables, true)
  const results: PickResult[] = []
  const seen = new Set<string>()
  for (const hit of hits) {
    const modelID = resolveModelID(hit.object)
    if (modelID === null || modelID < 0) continue
    const expressID = resolveExpressID(modelID, hit)
    if (!Number.isFinite(expressID) || expressID <= 0) continue
    const key = `${modelID}:${expressID}`
    if (seen.has(key)) continue
    seen.add(key)
    results.push({
      id: expressID,
      modelID,
      point: hit.point.clone(),
      distance: hit.distance,
      object: hit.object
    })
  }
  return results
}
