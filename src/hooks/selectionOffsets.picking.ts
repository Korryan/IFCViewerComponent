import { Raycaster, Vector2 } from 'three'
import type { IfcViewerAPI } from '../viewer/IfcViewerAPICompat'

export type PickCandidate = {
  modelID: number
  expressID: number
  kind: 'ifc' | 'custom'
  distance: number
}

type MeshHit = {
  object?: {
    modelID?: number
    geometry?: {
      getAttribute?: (name: string) => any
      index?: any
    }
  }
  face?: { a?: number }
  faceIndex?: number
  distance?: number
}

// Resolves the custom express id encoded into a hit geometry's expressID attribute.
export const getExpressIdFromHit = (hit: MeshHit): number | null => {
  const geometry = hit.object?.geometry
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
}

// Collects sorted IFC and custom-object pick candidates around one screen sample point.
const collectSampleCandidates = (
  viewer: IfcViewerAPI,
  customObjects: unknown[],
  rect: DOMRect,
  sampleX: number,
  sampleY: number
): PickCandidate[] => {
  if (
    sampleX < rect.left ||
    sampleX > rect.right ||
    sampleY < rect.top ||
    sampleY > rect.bottom
  ) {
    return []
  }

  const ndc = new Vector2(
    ((sampleX - rect.left) / rect.width) * 2 - 1,
    -((sampleY - rect.top) / rect.height) * 2 + 1
  )
  const raycaster = new Raycaster()
  raycaster.setFromCamera(ndc, viewer.context.getCamera())

  const cubeHits = raycaster.intersectObjects(customObjects as any[], true) as MeshHit[]
  const cubeCandidates: PickCandidate[] = []
  const localSeen = new Set<string>()
  for (const hit of cubeHits) {
    const modelID = hit.object?.modelID
    if (typeof modelID !== 'number') continue
    const expressID = getExpressIdFromHit(hit)
    if (expressID === null) continue
    const key = `${modelID}:${expressID}`
    if (localSeen.has(key)) continue
    localSeen.add(key)
    cubeCandidates.push({
      modelID,
      expressID,
      kind: 'custom',
      distance: hit.distance ?? Number.POSITIVE_INFINITY
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

// Appends only nearby candidates so overlap menus stay anchored to the first hit depth.
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

// Returns the overlap-aware candidate list used by click selection and the K menu.
export const pickCandidatesAtPoint = (
  viewer: IfcViewerAPI,
  customObjects: unknown[],
  clientX: number,
  clientY: number,
  container: HTMLElement,
  maxDistance = 0.02
): PickCandidate[] => {
  const rect = container.getBoundingClientRect()
  if (rect.width === 0 || rect.height === 0) return []

  const centerCandidates = collectSampleCandidates(
    viewer,
    customObjects,
    rect,
    clientX,
    clientY
  )
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
      const local = collectSampleCandidates(
        viewer,
        customObjects,
        rect,
        clientX + offset.x,
        clientY + offset.y
      )
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
    const local = collectSampleCandidates(
      viewer,
      customObjects,
      rect,
      clientX + offset.x,
      clientY + offset.y
    )
    if (local.length === 0) return
    addWithinLimit(local, overlapLimit, results, seenKeys)
  })

  return results
}
