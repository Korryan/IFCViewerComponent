import type { Dispatch, MutableRefObject, SetStateAction } from 'react'
import { Vector3, type Mesh } from 'three'
import type { OffsetVector, Point3D, PropertyField, SelectedElement } from '../ifcViewerTypes'
import type { IfcViewerAPI } from '../viewer/IfcViewerAPICompat'
import { CUSTOM_CUBE_MODEL_ID, zeroOffset } from './selectionOffsets.shared'
import type { CustomObjectRegistryRefs } from './selectionOffsets.customRegistry'
import { setCustomObjectHighlight } from './selectionOffsets.customRegistry'

type SetState<T> = Dispatch<SetStateAction<T>>

// Moves the camera target to a point while preserving the current viewing direction.
export const focusViewerOnPoint = (viewer: IfcViewerAPI | null, point: Point3D | null) => {
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
}

// Updates the highlighted custom object id used by cube and prefab selection.
export const setHighlightedCustomObject = (
  refs: CustomObjectRegistryRefs,
  expressID: number | null
) => {
  setCustomObjectHighlight(refs, expressID)
}

// Returns the current world-space position of the selected IFC element or custom object.
export const getSelectedElementWorldPosition = (args: {
  selectedElement: SelectedElement | null
  offsetInputs: OffsetVector
  cubeRegistryRef: MutableRefObject<Map<number, Mesh>>
}) => {
  if (!args.selectedElement) return null
  if (args.selectedElement.modelID === CUSTOM_CUBE_MODEL_ID) {
    const customObject = args.cubeRegistryRef.current.get(args.selectedElement.expressID)
    return customObject ? customObject.position.clone() : null
  }
  return new Vector3(args.offsetInputs.dx, args.offsetInputs.dy, args.offsetInputs.dz)
}

// Clears selection state, pending property requests, and active viewer highlights in one step.
export const resetSelectionState = (args: {
  propertyRequestRef: MutableRefObject<number>
  setSelectedElement: SetState<SelectedElement | null>
  setOffsetInputs: SetState<OffsetVector>
  setPropertyFields: SetState<PropertyField[]>
  setPropertyError: SetState<string | null>
  setIsFetchingProperties: SetState<boolean>
  focusOffsetRef: MutableRefObject<Point3D | null>
  customObjectRegistryRefs: CustomObjectRegistryRefs
  clearIfcSelectionHighlight: () => void
  viewer: IfcViewerAPI | null
}) => {
  args.propertyRequestRef.current += 1
  args.setSelectedElement(null)
  args.setOffsetInputs(zeroOffset)
  args.setPropertyFields([])
  args.setPropertyError(null)
  args.setIsFetchingProperties(false)
  setHighlightedCustomObject(args.customObjectRegistryRefs, null)
  args.focusOffsetRef.current = null
  args.clearIfcSelectionHighlight()
  args.viewer?.IFC.selector.unpickIfcItems()
}
