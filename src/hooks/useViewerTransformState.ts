import { useCallback, useRef, useState } from 'react'
import type { Dispatch, MutableRefObject, SetStateAction } from 'react'
import type { Plane, Vector3 } from 'three'
import type { OffsetVector, Point3D, SelectedElement } from '../ifcViewerTypes'
import { CUSTOM_CUBE_MODEL_ID } from './useSelectionOffsets'
import {
  hasOffsetChanged,
  hasRotationChanged,
  type TransformAxisLock
} from './viewerInteractions.transform'

type UseViewerTransformStateArgs = {
  offsetInputs: OffsetVector
  moveSelectedTo: (targetOffset: OffsetVector) => void
  pushHistoryEntry: (ifcId: number, label: string, timestamp?: string) => void
  rotateSelectedTo: (targetRotation: Point3D) => void
  selectedElement: SelectedElement | null
  syncSelectedCubePosition: () => void
  syncSelectedIfcPosition: () => void
}

type UseViewerTransformStateResult = {
  dragAxisLock: TransformAxisLock
  dragModeStartOffsetRef: MutableRefObject<OffsetVector | null>
  dragPlaneRef: MutableRefObject<Plane | null>
  dragStartOffsetRef: MutableRefObject<OffsetVector | null>
  dragStartPointRef: MutableRefObject<Vector3 | null>
  finishDragMode: (options?: { commit?: boolean; revert?: boolean }) => void
  finishRotateMode: (options?: { commit?: boolean; revert?: boolean }) => void
  isDragging: boolean
  isRotating: boolean
  rotateAxisLock: TransformAxisLock
  rotateCurrentValueRef: MutableRefObject<Point3D | null>
  rotateStartPointerRef: MutableRefObject<{ x: number; y: number } | null>
  rotateStartValueRef: MutableRefObject<Point3D | null>
  setDragAxisLock: Dispatch<SetStateAction<TransformAxisLock>>
  setIsDragging: Dispatch<SetStateAction<boolean>>
  setIsRotating: Dispatch<SetStateAction<boolean>>
  setRotateAxisLock: Dispatch<SetStateAction<TransformAxisLock>>
  suppressNextSelectionClickRef: MutableRefObject<boolean>
}

// This hook owns the mutable refs and commit-or-revert logic for drag and rotate sessions.
export const useViewerTransformState = ({
  offsetInputs,
  moveSelectedTo,
  pushHistoryEntry,
  rotateSelectedTo,
  selectedElement,
  syncSelectedCubePosition,
  syncSelectedIfcPosition
}: UseViewerTransformStateArgs): UseViewerTransformStateResult => {
  const [isDragging, setIsDragging] = useState(false)
  const [dragAxisLock, setDragAxisLock] = useState<TransformAxisLock>(null)
  const dragPlaneRef = useRef<Plane | null>(null)
  const dragStartPointRef = useRef<Vector3 | null>(null)
  const dragStartOffsetRef = useRef<OffsetVector | null>(null)
  const dragModeStartOffsetRef = useRef<OffsetVector | null>(null)
  const [isRotating, setIsRotating] = useState(false)
  const [rotateAxisLock, setRotateAxisLock] = useState<TransformAxisLock>(null)
  const rotateStartPointerRef = useRef<{ x: number; y: number } | null>(null)
  const rotateStartValueRef = useRef<Point3D | null>(null)
  const rotateCurrentValueRef = useRef<Point3D | null>(null)
  const suppressNextSelectionClickRef = useRef(false)

  // This function finishes rotate mode by either restoring the previewed value or committing it to history.
  const finishRotateMode = useCallback(
    (options?: { commit?: boolean; revert?: boolean }) => {
      const shouldCommit = options?.commit ?? false
      const shouldRevert = options?.revert ?? false
      const start = rotateStartValueRef.current
      const current = rotateCurrentValueRef.current

      if (shouldRevert && start) {
        rotateSelectedTo(start)
      } else if (shouldCommit && start && current) {
        if (hasRotationChanged(start, current, 1e-6)) {
          syncSelectedCubePosition()
          syncSelectedIfcPosition()
          if (selectedElement && selectedElement.modelID !== CUSTOM_CUBE_MODEL_ID) {
            pushHistoryEntry(selectedElement.expressID, 'Rotation updated')
          }
        }
      }

      setIsRotating(false)
      setRotateAxisLock(null)
      rotateStartPointerRef.current = null
      rotateStartValueRef.current = null
      rotateCurrentValueRef.current = null
    },
    [
      pushHistoryEntry,
      rotateSelectedTo,
      selectedElement,
      syncSelectedCubePosition,
      syncSelectedIfcPosition
    ]
  )

  // This function finishes drag mode by either restoring the previewed offset or committing it to history.
  const finishDragMode = useCallback(
    (options?: { commit?: boolean; revert?: boolean }) => {
      const shouldCommit = options?.commit ?? false
      const shouldRevert = options?.revert ?? false
      const startOffset = dragModeStartOffsetRef.current

      if (shouldRevert && startOffset) {
        moveSelectedTo(startOffset)
      } else if (shouldCommit && startOffset) {
        if (hasOffsetChanged(startOffset, offsetInputs)) {
          syncSelectedCubePosition()
          syncSelectedIfcPosition()
          if (selectedElement && selectedElement.modelID !== CUSTOM_CUBE_MODEL_ID) {
            pushHistoryEntry(selectedElement.expressID, 'Position updated')
          }
        }
      }

      setIsDragging(false)
      setDragAxisLock(null)
      dragPlaneRef.current = null
      dragStartPointRef.current = null
      dragStartOffsetRef.current = null
      dragModeStartOffsetRef.current = null
    },
    [
      moveSelectedTo,
      offsetInputs,
      pushHistoryEntry,
      selectedElement,
      syncSelectedCubePosition,
      syncSelectedIfcPosition
    ]
  )

  return {
    dragAxisLock,
    dragModeStartOffsetRef,
    dragPlaneRef,
    dragStartOffsetRef,
    dragStartPointRef,
    finishDragMode,
    finishRotateMode,
    isDragging,
    isRotating,
    rotateAxisLock,
    rotateCurrentValueRef,
    rotateStartPointerRef,
    rotateStartValueRef,
    setDragAxisLock,
    setIsDragging,
    setIsRotating,
    setRotateAxisLock,
    suppressNextSelectionClickRef
  }
}
