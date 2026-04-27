import type { ObjectTree } from './ifcViewerTypes'
import {
  MAX_ROOM_NUMBER_LOOKUPS,
  ROOM_NUMBER_BATCH_SIZE
} from './ifcViewer.constants'
import {
  extractRoomNumber
} from './ifcViewer.utils'
import type { IfcViewerAPI } from './viewer/IfcViewerAPICompat'

// Parses every referenced IFC entity id from one raw STEP payload fragment.
const parseIfcEntityIds = (raw: string): number[] => {
  const ids = raw.match(/#(\d+)/g) ?? []
  return ids
    .map((token) => Number(token.slice(1)))
    .filter((value) => Number.isFinite(value))
}

// Decodes escaped IFC text fragments into readable JavaScript strings.
const normalizeIfcEscapedText = (raw: string): string => {
  return raw
    .replace(/''/g, "'")
    .replace(/\\X2\\([0-9A-Fa-f]+)\\X0\\/g, (_match, hex) => {
      const codePoints: number[] = []
      for (let index = 0; index < hex.length; index += 4) {
        const chunk = hex.slice(index, index + 4)
        const parsed = Number.parseInt(chunk, 16)
        if (Number.isFinite(parsed)) {
          codePoints.push(parsed)
        }
      }
      return String.fromCodePoint(...codePoints)
    })
}

// Normalizes one optional room-number string into either a trimmed value or null.
const normalizeRoomNumber = (value: string | null | undefined): string | null => {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

// Extracts the string payload from one wrapped IFC scalar representation.
const extractIfcWrappedString = (raw: string): string | null => {
  const wrappedMatch = raw.match(/^[A-Z0-9_]+\('((?:[^']|'')*)'\)$/i)
  if (wrappedMatch) {
    return normalizeRoomNumber(normalizeIfcEscapedText(wrappedMatch[1]))
  }
  const plainMatch = raw.match(/^'((?:[^']|'')*)'$/)
  if (plainMatch) {
    return normalizeRoomNumber(normalizeIfcEscapedText(plainMatch[1]))
  }
  return normalizeRoomNumber(raw)
}

// Builds a room-number lookup directly from raw IFC text by following property-set relations.
const buildRoomNumberMapFromIfcText = (
  ifcText: string,
  candidateIds: Set<number>
): Map<number, string> => {
  const roomNumberPropertyIds = new Map<number, string>()
  const roomNumberByPsetId = new Map<number, string>()
  const roomNumberByElementId = new Map<number, string>()
  const lines = ifcText.split(/;\s*(?:\r?\n|$)/)

  lines.forEach((rawLine) => {
    const line = rawLine.trim()
    if (!line.startsWith('#')) return

    const propertyMatch = line.match(
      /^#(\d+)\s*=\s*IFCPROPERTYSINGLEVALUE\('((?:[^']|'')*)',\$,([^,]+),\$\)$/i
    )
    if (propertyMatch) {
      const propertyId = Number(propertyMatch[1])
      const propertyName = normalizeIfcEscapedText(propertyMatch[2]).trim().toLowerCase()
      if (propertyName === 'raumnummer' || propertyName === 'roomnumber') {
        const resolvedValue = extractIfcWrappedString(propertyMatch[3].trim())
        if (resolvedValue) {
          roomNumberPropertyIds.set(propertyId, resolvedValue)
        }
      }
      return
    }

    const psetMatch = line.match(/^#(\d+)\s*=\s*IFCPROPERTYSET\((.*)\)$/i)
    if (psetMatch) {
      const psetId = Number(psetMatch[1])
      const propertyIds = parseIfcEntityIds(psetMatch[2])
      for (const propertyId of propertyIds) {
        const roomNumber = roomNumberPropertyIds.get(propertyId)
        if (roomNumber) {
          roomNumberByPsetId.set(psetId, roomNumber)
          break
        }
      }
      return
    }

    const relMatch = line.match(/^#(\d+)\s*=\s*IFCRELDEFINESBYPROPERTIES\((.*)\)$/i)
    if (relMatch) {
      const ids = parseIfcEntityIds(relMatch[2])
      if (ids.length < 2) return
      const relatingPsetId = ids[ids.length - 1]
      const roomNumber = roomNumberByPsetId.get(relatingPsetId)
      if (!roomNumber) return

      ids.slice(0, -1).forEach((elementId) => {
        if (!candidateIds.has(elementId)) return
        roomNumberByElementId.set(elementId, roomNumber)
      })
    }
  })

  return roomNumberByElementId
}

// Collects the IFC express ids most likely to carry room-number metadata.
const collectRoomNumberCandidateExpressIds = (tree: ObjectTree): number[] => {
  const ids = new Set<number>()
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
    if (type === 'IFCPROJECT' || type === 'IFCSITE' || type === 'IFCBUILDING' || type === 'IFCBUILDINGSTOREY') {
      continue
    }
    if (type.startsWith('IFCREL')) continue
    ids.add(node.expressID)
  }

  if (ids.size > 0) {
    return Array.from(ids)
  }

  Object.values(tree.nodes).forEach((node) => {
    if (node.nodeType !== 'ifc' || node.expressID === null) return
    const type = node.type.toUpperCase()
    if (type === 'IFCPROJECT' || type === 'IFCSITE' || type === 'IFCBUILDING' || type === 'IFCBUILDINGSTOREY') {
      return
    }
    if (type.startsWith('IFCREL')) return
    ids.add(node.expressID)
  })

  return Array.from(ids)
}

// Builds the final room-number lookup by combining IFC text parsing with bounded property fetch fallbacks.
export const buildRoomNumberMap = async (
  viewer: IfcViewerAPI,
  tree: ObjectTree,
  modelID: number,
  ifcText?: string | null
): Promise<Map<number, string>> => {
  const expressIds = collectRoomNumberCandidateExpressIds(tree)
  if (expressIds.length === 0) return new Map()
  const candidateIds = new Set(expressIds)

  const ifcTextMap =
    typeof ifcText === 'string' && ifcText.trim().length > 0
      ? buildRoomNumberMapFromIfcText(ifcText, candidateIds)
      : new Map<number, string>()

  const lookupIds =
    expressIds
      .filter((expressID) => !ifcTextMap.has(expressID))
      .slice(0, MAX_ROOM_NUMBER_LOOKUPS)

  if (lookupIds.length < expressIds.filter((expressID) => !ifcTextMap.has(expressID)).length) {
    console.warn(
      `Room-number lookup limited to ${MAX_ROOM_NUMBER_LOOKUPS} IFC nodes to prevent OOM.`
    )
  }

  const results: Array<readonly [number, string] | null> = []
  for (let index = 0; index < lookupIds.length; index += ROOM_NUMBER_BATCH_SIZE) {
    const batch = lookupIds.slice(index, index + ROOM_NUMBER_BATCH_SIZE)
    const batchResults = await Promise.all(
      batch.map(async (expressID) => {
        try {
          const properties = await viewer.IFC.getProperties(modelID, expressID, false, true)
          const roomNumber = normalizeRoomNumber(extractRoomNumber(properties))
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
  ifcTextMap.forEach((roomNumber, expressID) => {
    map.set(expressID, roomNumber)
  })
  results.forEach((entry) => {
    if (!entry) return
    map.set(entry[0], entry[1])
  })
  return map
}
