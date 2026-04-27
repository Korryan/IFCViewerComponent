import type { Dispatch, MutableRefObject, SetStateAction } from 'react'
import type { Vector3 } from 'three'
import type { OffsetVector, Point3D, SelectedElement } from '../ifcViewerTypes'
import type { IfcViewerAPI } from '../viewer/IfcViewerAPICompat'
import type { PickCandidate } from './useSelectionOffsets'
import type { NavigationMode } from './viewerInteractions.camera'
import type { PickMenuItem } from './viewerInteractions.pick'

// Describes the public input contract accepted by the viewer interaction orchestration hook.
export type UseViewerInteractionsArgs = {
  containerRef: MutableRefObject<HTMLDivElement | null>
  viewerRef: MutableRefObject<IfcViewerAPI | null>
  ensureViewer: () => IfcViewerAPI | null
  selectedElement: SelectedElement | null
  offsetInputs: OffsetVector
  showShortcuts?: boolean
  canTransformSelected: boolean
  getSelectedWorldPosition: () => Vector3 | null
  getIfcElementRotationDelta: (modelID: number, expressID: number) => Point3D | null
  moveSelectedTo: (targetOffset: OffsetVector) => void
  rotateSelectedTo: (targetRotation: Point3D) => void
  resetSelection: () => void
  selectById: (
    modelID: number,
    expressID: number,
    options?: { autoFocus?: boolean; allowedIfcTypes?: string[] }
  ) => Promise<Point3D | null>
  selectCustomCube: (expressID: number) => void
  pickCandidatesAt: (
    clientX: number,
    clientY: number,
    container: HTMLElement,
    maxDistance?: number
  ) => PickCandidate[]
  syncSelectedCubePosition: () => void
  syncSelectedIfcPosition: () => void
  pushHistoryEntry: (ifcId: number, label: string, timestamp?: string) => void
}

// Describes the public result returned by the viewer interaction orchestration hook.
export type UseViewerInteractionsResult = {
  navigationMode: NavigationMode
  isWalkMode: boolean
  toggleNavigationMode: () => void
  applyNavigationMode: (viewer: IfcViewerAPI) => void
  stopWalkMovementLoop: () => void
  hoverCoords: Point3D | null
  isInsertMenuOpen: boolean
  insertMenuAnchor: { x: number; y: number } | null
  insertTargetCoords: Point3D | null
  closeInsertMenu: () => void
  isShortcutsOpen: boolean
  setIsShortcutsOpen: Dispatch<SetStateAction<boolean>>
  isPickMenuOpen: boolean
  pickMenuAnchor: { x: number; y: number } | null
  pickMenuItems: PickMenuItem[]
  closePickMenu: () => void
  handlePickMenuSelect: (candidateId: string) => void
  moveCameraToPoint: (point: Point3D | null) => boolean
  teleportCameraToPoint: (point: Point3D | null) => boolean
}
