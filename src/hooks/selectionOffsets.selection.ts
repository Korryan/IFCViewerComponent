import type { Dispatch, MutableRefObject, SetStateAction } from 'react'
import { Raycaster } from 'three'
import type { OffsetVector, Point3D, PropertyField, SelectedElement } from '../ifcViewerTypes'
import type { IfcViewerAPI } from '../viewer/IfcViewerAPICompat'
import { CUSTOM_CUBE_MODEL_ID, normalizeOffsetVector, pointToOffsetVector, zeroOffset } from './selectionOffsets.shared'

type SetState<T> = Dispatch<SetStateAction<T>>

type SelectionFlowSharedArgs = {
  viewer: IfcViewerAPI
  setSelectedElement: SetState<SelectedElement | null>
  setOffsetInputs: SetState<OffsetVector>
  setPropertyFields: SetState<PropertyField[]>
  setPropertyError: SetState<string | null>
  setIsFetchingProperties: SetState<boolean>
}

// Computes the fallback offset displayed in the coordinate inputs when no focus point is available.
const resolveFallbackOffset = (args: {
  modelID: number
  expressID: number
  key: string
  elementOffsetsRef: MutableRefObject<Map<string, OffsetVector>>
  getBaseCenter: (modelID: number, expressID: number) => Point3D | null
  getModelBaseOffset: (modelID: number) => OffsetVector
}) => {
  return (
    args.elementOffsetsRef.current.get(args.key) ??
    (() => {
      const baseCenter = args.getBaseCenter(args.modelID, args.expressID)
      if (!baseCenter) return args.getModelBaseOffset(args.modelID)
      return {
        dx: baseCenter.x,
        dy: baseCenter.y,
        dz: baseCenter.z
      }
    })()
  )
}

// Loads IFC properties for the current selection and updates inspector state while guarding against stale requests.
export const fetchSelectionProperties = async (
  args: SelectionFlowSharedArgs & {
    modelID: number
    expressID: number
    focusPoint?: Point3D | null
    propertyRequestRef: MutableRefObject<number>
    focusOffsetRef: MutableRefObject<Point3D | null>
    elementOffsetsRef: MutableRefObject<Map<string, OffsetVector>>
    buildPropertyFields: (rawProperties: any) => PropertyField[]
    getElementKey: (modelID: number, expressID: number) => string
    getElementWorldPosition: (modelID: number, expressID: number) => Point3D | null
    getModelBaseOffset: (modelID: number) => OffsetVector
    getBaseCenter: (modelID: number, expressID: number) => Point3D | null
    primeIfcPlacementOrigin: (
      modelID: number,
      expressID: number,
      properties?: any
    ) => Promise<Point3D | null>
  }
) => {
  const requestToken = ++args.propertyRequestRef.current
  args.setIsFetchingProperties(true)
  args.setPropertyError(null)

  try {
    const properties = await args.viewer.IFC.getProperties(args.modelID, args.expressID, false, true)
    if (!properties) {
      throw new Error('No properties returned for this element.')
    }
    if (args.propertyRequestRef.current !== requestToken) {
      return
    }

    const resolvedType =
      typeof properties.ifcClass === 'string'
        ? properties.ifcClass
        : typeof properties.type === 'string'
          ? properties.type
          : typeof properties.type === 'number'
            ? String(properties.type)
            : undefined

    await args.primeIfcPlacementOrigin(args.modelID, args.expressID, properties)
    args.setSelectedElement({
      modelID: args.modelID,
      expressID: args.expressID,
      type: resolvedType
    })

    const key = args.getElementKey(args.modelID, args.expressID)
    const resolvedFocus = args.focusPoint ?? args.getElementWorldPosition(args.modelID, args.expressID)
    const currentCenter = args.getElementWorldPosition(args.modelID, args.expressID)
    if (resolvedFocus && currentCenter) {
      args.focusOffsetRef.current = {
        x: resolvedFocus.x - currentCenter.x,
        y: resolvedFocus.y - currentCenter.y,
        z: resolvedFocus.z - currentCenter.z
      }
    } else {
      args.focusOffsetRef.current = null
    }

    if (resolvedFocus) {
      args.setOffsetInputs(pointToOffsetVector(resolvedFocus))
    } else {
      args.setOffsetInputs(
        normalizeOffsetVector(
          resolveFallbackOffset({
            modelID: args.modelID,
            expressID: args.expressID,
            key,
            elementOffsetsRef: args.elementOffsetsRef,
            getBaseCenter: args.getBaseCenter,
            getModelBaseOffset: args.getModelBaseOffset
          })
        )
      )
    }

    args.setPropertyFields(args.buildPropertyFields(properties))
  } catch (err) {
    if (args.propertyRequestRef.current !== requestToken) {
      return
    }
    console.error('Failed to load IFC properties', err)
    args.setPropertyError('Unable to load IFC properties for the selected element.')
    args.setSelectedElement((prev) => {
      if (prev && prev.modelID === args.modelID && prev.expressID === args.expressID) {
        return prev
      }
      return { modelID: args.modelID, expressID: args.expressID }
    })
    args.setPropertyFields([])
  } finally {
    if (args.propertyRequestRef.current === requestToken) {
      args.setIsFetchingProperties(false)
    }
  }
}

// Selects a custom object under the pointer or falls back to the engine IFC picker for native elements.
export const handleSelectionPick = async (
  args: SelectionFlowSharedArgs & {
    options?: { autoFocus?: boolean; allowedIfcTypes?: string[] }
    cubeRegistryRef: MutableRefObject<Map<number, any>>
    cubeIdCounterRef: MutableRefObject<number>
    elementOffsetsRef: MutableRefObject<Map<string, OffsetVector>>
    buildCustomPropertyFields: (expressID: number) => PropertyField[]
    fetchProperties: (modelID: number, expressID: number, focusPoint?: Point3D | null) => Promise<void>
    applyIfcSelectionHighlight: (modelID: number, expressID: number) => void
    clearIfcSelectionHighlight: (modelID?: number | null) => void
    getCustomObjectState: (expressID: number) => { model?: string } | null
    getElementWorldPosition: (modelID: number, expressID: number) => Point3D | null
    getExpressIdFromHit: (hit: { object: any; face?: { a?: number }; faceIndex?: number }) => number | null
    isIfcSelectionAllowed: (
      viewer: IfcViewerAPI,
      modelID: number,
      expressID: number,
      options?: { allowedIfcTypes?: string[] }
    ) => Promise<boolean>
    resetSelection: () => void
    setCubeHighlight: (expressID: number | null) => void
    focusOnPoint: (point: Point3D | null) => void
  }
) => {
  const shouldAutoFocus = args.options?.autoFocus ?? false
  const camera = args.viewer.context.getCamera()
  const pointer = args.viewer.context.mouse.position
  const raycaster = new Raycaster()
  raycaster.setFromCamera(pointer, camera)
  const customMeshes = Array.from(args.cubeRegistryRef.current.values())
  const cubeHit = customMeshes.length ? raycaster.intersectObjects(customMeshes, true)[0] : undefined
  const ifcHit = args.viewer.context.castRayIfc()
  const resolvedHit = cubeHit && (!ifcHit || cubeHit.distance <= ifcHit.distance) ? cubeHit : ifcHit
  const hitObject: any = resolvedHit?.object

  if (resolvedHit && hitObject?.modelID === CUSTOM_CUBE_MODEL_ID) {
    args.clearIfcSelectionHighlight()
    args.viewer.IFC.selector.unpickIfcItems()
    const hitExpressId = args.getExpressIdFromHit(resolvedHit as any) ?? args.cubeIdCounterRef.current
    const key = `cube:${hitExpressId}`
    const customState = args.getCustomObjectState(hitExpressId)
    args.setSelectedElement({
      modelID: CUSTOM_CUBE_MODEL_ID,
      expressID: hitExpressId,
      type: customState?.model?.toUpperCase() ?? 'CUSTOM'
    })
    const cube = args.cubeRegistryRef.current.get(hitExpressId)
    const pos = cube?.position
    args.setOffsetInputs(pos ? pointToOffsetVector(pos) : zeroOffset)
    args.setPropertyFields(args.buildCustomPropertyFields(hitExpressId))
    args.elementOffsetsRef.current.set(key, pos ? pointToOffsetVector(pos) : zeroOffset)
    args.setCubeHighlight(hitExpressId)
    return
  }

  args.setCubeHighlight(null)

  const picked = await args.viewer.IFC.selector.pickIfcItem(false)
  if (!picked || picked.id === undefined || picked.modelID === undefined) {
    args.viewer.IFC.selector.unpickIfcItems()
    args.resetSelection()
    return
  }

  const isAllowed = await args.isIfcSelectionAllowed(args.viewer, picked.modelID, picked.id, args.options)
  if (!isAllowed) {
    args.viewer.IFC.selector.unpickIfcItems()
    args.resetSelection()
    return
  }

  args.viewer.IFC.selector.unpickIfcItems()
  args.applyIfcSelectionHighlight(picked.modelID, picked.id)
  args.setSelectedElement({ modelID: picked.modelID, expressID: picked.id })
  args.setPropertyError(null)
  const focusPoint = shouldAutoFocus
    ? picked.point
      ? { x: picked.point.x, y: picked.point.y, z: picked.point.z }
      : args.getElementWorldPosition(picked.modelID, picked.id)
    : null
  if (shouldAutoFocus && focusPoint) {
    args.focusOnPoint(focusPoint)
  }
  await args.fetchProperties(picked.modelID, picked.id, focusPoint)
}

// Selects one IFC element by id, applies highlight, and optionally focuses the camera on its resolved position.
export const selectIfcElementById = async (
  args: SelectionFlowSharedArgs & {
    modelID: number
    expressID: number
    options?: { autoFocus?: boolean; allowedIfcTypes?: string[] }
    elementOffsetsRef: MutableRefObject<Map<string, OffsetVector>>
    fetchProperties: (modelID: number, expressID: number, focusPoint?: Point3D | null) => Promise<void>
    getElementKey: (modelID: number, expressID: number) => string
    focusOnPoint: (point: Point3D | null) => void
    getElementWorldPosition: (modelID: number, expressID: number) => Point3D | null
    getModelBaseOffset: (modelID: number) => OffsetVector
    getBaseCenter: (modelID: number, expressID: number) => Point3D | null
    hasRenderableExpressId: (modelID: number, expressID: number) => boolean
    isIfcSelectionAllowed: (
      viewer: IfcViewerAPI,
      modelID: number,
      expressID: number,
      options?: { allowedIfcTypes?: string[] }
    ) => Promise<boolean>
    resetSelection: () => void
    applyIfcSelectionHighlight: (modelID: number, expressID: number) => void
    clearIfcSelectionHighlight: (modelID?: number | null) => void
  }
): Promise<Point3D | null> => {
  const isAllowed = await args.isIfcSelectionAllowed(
    args.viewer,
    args.modelID,
    args.expressID,
    args.options
  )
  if (!isAllowed) {
    args.viewer.IFC.selector.unpickIfcItems()
    args.resetSelection()
    return null
  }

  const isRenderable = args.hasRenderableExpressId(args.modelID, args.expressID)
  const shouldAutoFocus = args.options?.autoFocus ?? false
  args.viewer.IFC.selector.unpickIfcItems()
  args.setSelectedElement({ modelID: args.modelID, expressID: args.expressID })
  args.setPropertyError(null)
  if (isRenderable) {
    args.applyIfcSelectionHighlight(args.modelID, args.expressID)
  } else {
    args.clearIfcSelectionHighlight(args.modelID)
  }

  const focusPoint =
    shouldAutoFocus && isRenderable
      ? args.getElementWorldPosition(args.modelID, args.expressID)
      : null
  void args.fetchProperties(args.modelID, args.expressID, focusPoint)

  const elementCenter = args.getElementWorldPosition(args.modelID, args.expressID)
  const resolvedPoint = shouldAutoFocus ? (focusPoint ?? elementCenter) : elementCenter
  const selectionPoint =
    resolvedPoint ??
    (() => {
      const key = args.getElementKey(args.modelID, args.expressID)
      const fallbackOffset = resolveFallbackOffset({
        modelID: args.modelID,
        expressID: args.expressID,
        key,
        elementOffsetsRef: args.elementOffsetsRef,
        getBaseCenter: args.getBaseCenter,
        getModelBaseOffset: args.getModelBaseOffset
      })
      return { x: fallbackOffset.dx, y: fallbackOffset.dy, z: fallbackOffset.dz }
    })()

  if (shouldAutoFocus && selectionPoint) {
    args.focusOnPoint(selectionPoint)
  }
  return selectionPoint
}
