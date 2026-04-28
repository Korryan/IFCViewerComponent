import type { Vector3 } from 'three'
import type { FurnitureGeometry, OffsetVector, Point3D, PropertyField, SelectedElement } from '../ifcViewerTypes'
import type { CustomObjectState, SpawnedCubeInfo, SpawnedModelInfo } from './selectionOffsets.customRegistry'
import type { PickCandidate } from './selectionOffsets.picking'

// Describes optional spawn behavior for one newly inserted cube object.
export type SpawnCubeOptions = {
  focus?: boolean
  id?: number
}

// Describes the public API returned by the selection-offset hook.
export type UseSelectionOffsetsResult = {
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
  getIfcElementPlacementPosition: (modelID: number, expressID: number) => Point3D | null
  ensureIfcPlacementPosition: (modelID: number, expressID: number) => Promise<Point3D | null>
  getIfcElementTranslationDelta: (modelID: number, expressID: number) => Point3D | null
  getIfcElementRotationDelta: (modelID: number, expressID: number) => Point3D | null
  getElementWorldPosition: (modelID: number, expressID: number) => Point3D | null
  moveSelectedTo: (targetOffset: OffsetVector) => void
  applyIfcElementOffset: (modelID: number, expressID: number, targetOffset: OffsetVector) => void
  applyIfcElementRotation: (modelID: number, expressID: number, targetRotation: Point3D) => void
  rotateSelectedTo: (targetRotation: Point3D) => void
  hideIfcElement: (modelID: number, expressID: number) => void
  setCustomCubeRoomNumber: (expressID: number, roomNumber?: string | null) => void
  setCustomObjectSpaceIfcId: (expressID: number, spaceIfcId?: number | null) => void
  setCustomObjectItemId: (expressID: number, itemId?: string | null) => void
  findCustomObjectExpressIdByItemId: (itemId: string | null | undefined) => number | null
  getCustomObjectState: (expressID: number) => CustomObjectState | null
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
  spawnStoredCustomObject: (args: {
    itemId: string
    model: string
    name?: string | null
    position: Point3D
    rotation?: Point3D | null
    geometry: FurnitureGeometry
    roomNumber?: string | null
    spaceIfcId?: number | null
    sourceFileName?: string | null
    focus?: boolean
  }) => { expressID: number; position: Point3D } | null
  applyVisibilityFilter: (modelID: number, visibleIds: number[] | null) => void
  configureSpaceBiasTargets: (modelID: number, expressIDs: number[]) => void
}
