import type { IfcViewerAPI } from '../viewer/IfcViewerAPICompat'
import type { PickCandidate } from './useSelectionOffsets'

export type PickMenuItem = {
  id: string
  label: string
  meta?: string
}

export type PickAction =
  | {
      type: 'menu'
      candidates: PickCandidate[]
      anchor: { x: number; y: number }
    }
  | {
      type: 'select'
      candidate: PickCandidate
    }
  | {
      type: 'reset'
    }

// This function converts raw pick candidates into the lightweight menu rows shown in the overlay.
export const buildPickMenuItems = (
  candidates: PickCandidate[],
  candidateTypes: Record<string, string>
): PickMenuItem[] =>
  candidates.map((candidate) => ({
    id: `${candidate.modelID}:${candidate.expressID}`,
    label: `#${candidate.expressID}`,
    meta: candidateTypes[`${candidate.modelID}:${candidate.expressID}`]
  }))

// This function builds a stable lookup map so the menu can resolve the clicked row back to its candidate.
export const buildPickMenuLookup = (candidates: PickCandidate[]): Map<string, PickCandidate> =>
  new Map(candidates.map((candidate) => [`${candidate.modelID}:${candidate.expressID}`, candidate]))

// This function clamps the overlay anchor so the pick menu stays inside the viewer bounds.
export const buildPickMenuAnchor = (
  clientX: number,
  clientY: number,
  rect: DOMRect
): { x: number; y: number } => ({
  x: Math.max(0, Math.min(clientX - rect.left + 12, rect.width - 12)),
  y: Math.max(0, Math.min(clientY - rect.top + 12, rect.height - 12))
})

// This function decides whether a click should open the overlap menu, select one object, or clear selection.
export const resolvePickAction = (
  candidates: PickCandidate[],
  clientX: number,
  clientY: number,
  rect: DOMRect
): PickAction => {
  if (candidates.length > 1) {
    return {
      type: 'menu',
      candidates,
      anchor: buildPickMenuAnchor(clientX, clientY, rect)
    }
  }

  if (candidates.length === 1) {
    return {
      type: 'select',
      candidate: candidates[0]
    }
  }

  return { type: 'reset' }
}

// This function resolves the IFC type labels used in the overlap menu for each candidate.
export const resolvePickCandidateTypes = async (
  viewer: IfcViewerAPI | null,
  candidates: PickCandidate[]
): Promise<Record<string, string>> => {
  const fallbackEntries = candidates.map((candidate) => [
    `${candidate.modelID}:${candidate.expressID}`,
    candidate.kind === 'custom' ? 'custom cube' : 'ifc element'
  ])

  if (!viewer) {
    return Object.fromEntries(fallbackEntries)
  }

  const entries = await Promise.all(
    candidates.map(async (candidate) => {
      const key = `${candidate.modelID}:${candidate.expressID}`
      if (candidate.kind === 'custom') {
        return [key, 'custom cube'] as const
      }

      try {
        const directType = getDirectIfcType(viewer, candidate.modelID, candidate.expressID)
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

  return Object.fromEntries(entries)
}

// This function reads the IFC class name from the low-level manager when that faster path is available.
const getDirectIfcType = (
  viewer: IfcViewerAPI,
  modelID: number,
  expressID: number
): string | undefined => {
  const manager = viewer.IFC?.loader?.ifcManager as
    | { getIfcType?: (currentModelID: number, currentExpressID: number) => string | undefined }
    | undefined
  return manager?.getIfcType?.(modelID, expressID)
}
