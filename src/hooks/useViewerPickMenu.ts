import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MutableRefObject } from 'react'
import type { Point3D } from '../ifcViewerTypes'
import type { IfcViewerAPI } from '../viewer/IfcViewerAPICompat'
import type { PickCandidate } from './useSelectionOffsets'
import {
  buildPickMenuItems,
  buildPickMenuLookup,
  resolvePickAction,
  resolvePickCandidateTypes,
  type PickMenuItem
} from './viewerInteractions.pick'

type UseViewerPickMenuArgs = {
  pickCandidatesAt: (
    clientX: number,
    clientY: number,
    container: HTMLElement,
    maxDistance?: number
  ) => PickCandidate[]
  resetSelection: () => void
  selectById: (
    modelID: number,
    expressID: number,
    options?: { autoFocus?: boolean; allowedIfcTypes?: string[] }
  ) => Promise<Point3D | null>
  selectCustomCube: (expressID: number) => void
  viewerRef: MutableRefObject<IfcViewerAPI | null>
}

type UseViewerPickMenuResult = {
  closePickMenu: () => void
  handlePickMenuSelect: (candidateId: string) => void
  isPickMenuOpen: boolean
  openSelectionAt: (clientX: number, clientY: number, container: HTMLElement) => void
  pickMenuAnchor: { x: number; y: number } | null
  pickMenuItems: PickMenuItem[]
}

// This hook owns overlap-pick state, menu rendering data, and click-to-select resolution for the viewer.
export const useViewerPickMenu = ({
  pickCandidatesAt,
  resetSelection,
  selectById,
  selectCustomCube,
  viewerRef
}: UseViewerPickMenuArgs): UseViewerPickMenuResult => {
  const [isPickMenuOpen, setIsPickMenuOpen] = useState(false)
  const [pickMenuAnchor, setPickMenuAnchor] = useState<{ x: number; y: number } | null>(null)
  const [pickCandidates, setPickCandidates] = useState<PickCandidate[]>([])
  const [pickCandidateTypes, setPickCandidateTypes] = useState<Record<string, string>>({})
  const pickTypeRequestRef = useRef(0)

  const pickMenuItems = useMemo(
    () => buildPickMenuItems(pickCandidates, pickCandidateTypes),
    [pickCandidateTypes, pickCandidates]
  )

  const pickMenuLookup = useMemo(() => buildPickMenuLookup(pickCandidates), [pickCandidates])

  // This function clears the overlap-pick menu state and forgets the candidates from the last click.
  const closePickMenu = useCallback(() => {
    setIsPickMenuOpen(false)
    setPickMenuAnchor(null)
    setPickCandidates([])
    setPickCandidateTypes({})
  }, [])

  // This function resolves a clicked menu row back to its candidate and applies the matching selection path.
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

    const token = ++pickTypeRequestRef.current
    void resolvePickCandidateTypes(viewerRef.current, pickCandidates).then((types) => {
      if (pickTypeRequestRef.current !== token) return
      setPickCandidateTypes(types)
    })
  }, [isPickMenuOpen, pickCandidates, viewerRef])

  // This function resolves a click into either one direct selection, an overlap menu, or a full reset.
  const openSelectionAt = useCallback(
    (clientX: number, clientY: number, container: HTMLElement) => {
      const rect = container.getBoundingClientRect()
      const candidates = pickCandidatesAt(clientX, clientY, container, 0.02)
      const pickAction = resolvePickAction(candidates, clientX, clientY, rect)

      if (pickAction.type === 'menu') {
        setPickCandidates(pickAction.candidates)
        setIsPickMenuOpen(true)
        setPickMenuAnchor(pickAction.anchor)
        return
      }

      closePickMenu()
      if (pickAction.type === 'select') {
        const { candidate } = pickAction
        if (candidate.kind === 'custom') {
          selectCustomCube(candidate.expressID)
        } else {
          void selectById(candidate.modelID, candidate.expressID, { autoFocus: false })
        }
        return
      }

      resetSelection()
    },
    [closePickMenu, pickCandidatesAt, resetSelection, selectById, selectCustomCube]
  )

  return {
    closePickMenu,
    handlePickMenuSelect,
    isPickMenuOpen,
    openSelectionAt,
    pickMenuAnchor,
    pickMenuItems
  }
}

export type { PickMenuItem }
