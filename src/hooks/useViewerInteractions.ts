import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Dispatch, MutableRefObject, SetStateAction } from 'react'
import CameraControls from 'camera-controls'
import { Plane, Raycaster, Vector2, Vector3 } from 'three'
import type { IfcViewerAPI } from '../viewer/IfcViewerAPICompat'
import type { OffsetVector, Point3D, SelectedElement } from '../ifcViewerTypes'
import { CUSTOM_CUBE_MODEL_ID, type PickCandidate } from './useSelectionOffsets'
import {
  FREE_WHEEL_MAX_DELTA,
  FREE_WHEEL_MOVE_FACTOR,
  ROTATE_DRAG_SENSITIVITY,
  ROTATION_EPSILON,
  WALK_DRAG_MOVE_PER_PIXEL,
  WALK_LOOK_SENSITIVITY,
  WALK_MOVE_SPEED,
  WALK_PITCH_LIMIT
} from '../ifcViewer.constants'

export type NavigationMode = 'free' | 'walk'
type WalkMoveKey = 'arrowup' | 'arrowleft' | 'arrowdown' | 'arrowright'

type UseViewerInteractionsArgs = {
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

type PickMenuItem = {
  id: string
  label: string
  meta?: string
}

type UseViewerInteractionsResult = {
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

const emptyWalkKeyState: Record<WalkMoveKey, boolean> = {
  arrowup: false,
  arrowleft: false,
  arrowdown: false,
  arrowright: false
}

const getWalkMoveKey = (event: KeyboardEvent): WalkMoveKey | null => {
  const key = event.key.toLowerCase()
  if (key === 'arrowup' || key === 'up' || event.code === 'ArrowUp') return 'arrowup'
  if (key === 'arrowleft' || key === 'left' || event.code === 'ArrowLeft') return 'arrowleft'
  if (key === 'arrowdown' || key === 'down' || event.code === 'ArrowDown') return 'arrowdown'
  if (key === 'arrowright' || key === 'right' || event.code === 'ArrowRight') return 'arrowright'
  return null
}

const applyNavigationControls = (viewer: IfcViewerAPI, mode: NavigationMode) => {
  const controls = viewer.context.ifcCamera.cameraControls
  if (mode === 'walk') {
    controls.mouseButtons.left = CameraControls.ACTION.NONE
    controls.mouseButtons.middle = CameraControls.ACTION.NONE
    controls.mouseButtons.right = CameraControls.ACTION.NONE
    controls.mouseButtons.wheel = CameraControls.ACTION.NONE
    return
  }

  controls.mouseButtons.left = CameraControls.ACTION.NONE
  controls.mouseButtons.middle = CameraControls.ACTION.ROTATE
  controls.mouseButtons.right = CameraControls.ACTION.TRUCK
  controls.mouseButtons.wheel = CameraControls.ACTION.NONE
}

export const useViewerInteractions = ({
  containerRef,
  viewerRef,
  ensureViewer,
  selectedElement,
  offsetInputs,
  showShortcuts,
  canTransformSelected,
  getSelectedWorldPosition,
  getIfcElementRotationDelta,
  moveSelectedTo,
  rotateSelectedTo,
  resetSelection,
  selectById,
  selectCustomCube,
  pickCandidatesAt,
  syncSelectedCubePosition,
  syncSelectedIfcPosition,
  pushHistoryEntry
}: UseViewerInteractionsArgs): UseViewerInteractionsResult => {
  const lastPointerPosRef = useRef<{ x: number; y: number }>({ x: 16, y: 16 })
  const [navigationMode, setNavigationMode] = useState<NavigationMode>('free')
  const [hoverCoords, setHoverCoords] = useState<Point3D | null>(null)
  const [isInsertMenuOpen, setIsInsertMenuOpen] = useState(false)
  const [insertMenuAnchor, setInsertMenuAnchor] = useState<{ x: number; y: number } | null>(null)
  const [insertTargetCoords, setInsertTargetCoords] = useState<Point3D | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [dragAxisLock, setDragAxisLock] = useState<'x' | 'y' | 'z' | null>(null)
  const dragPlaneRef = useRef<Plane | null>(null)
  const dragStartPointRef = useRef<Vector3 | null>(null)
  const dragStartOffsetRef = useRef<OffsetVector | null>(null)
  const dragModeStartOffsetRef = useRef<OffsetVector | null>(null)
  const [isRotating, setIsRotating] = useState(false)
  const [rotateAxisLock, setRotateAxisLock] = useState<'x' | 'y' | 'z' | null>(null)
  const rotateStartPointerRef = useRef<{ x: number; y: number } | null>(null)
  const rotateStartValueRef = useRef<Point3D | null>(null)
  const rotateCurrentValueRef = useRef<Point3D | null>(null)
  const suppressNextSelectionClickRef = useRef(false)
  const [isShortcutsOpen, setIsShortcutsOpen] = useState(false)
  const [isPickMenuOpen, setIsPickMenuOpen] = useState(false)
  const [pickMenuAnchor, setPickMenuAnchor] = useState<{ x: number; y: number } | null>(null)
  const [pickCandidates, setPickCandidates] = useState<PickCandidate[]>([])
  const [pickCandidateTypes, setPickCandidateTypes] = useState<Record<string, string>>({})
  const pickTypeRequestRef = useRef(0)
  const navigationModeRef = useRef<NavigationMode>(navigationMode)
  const walkKeyStateRef = useRef<Record<WalkMoveKey, boolean>>({ ...emptyWalkKeyState })
  const walkHeadingRef = useRef<Vector3>(new Vector3(0, 0, -1))
  const walkFrameRef = useRef<number | null>(null)
  const walkLastTimestampRef = useRef<number | null>(null)
  const walkMoveActiveRef = useRef(false)
  const walkLookActiveRef = useRef(false)
  const walkLookPointerIdRef = useRef<number | null>(null)
  const walkLookLastPointerRef = useRef<{ x: number; y: number } | null>(null)
  const walkDragActiveRef = useRef(false)
  const walkDragPointerIdRef = useRef<number | null>(null)
  const walkDragLastPointerRef = useRef<{ x: number; y: number } | null>(null)

  const isWalkMode = navigationMode === 'walk'

  const toggleNavigationMode = useCallback(() => {
    setNavigationMode((prev) => (prev === 'free' ? 'walk' : 'free'))
  }, [])

  useEffect(() => {
    navigationModeRef.current = navigationMode
  }, [navigationMode])

  useEffect(() => {
    if (!showShortcuts && isShortcutsOpen) {
      setIsShortcutsOpen(false)
    }
  }, [isShortcutsOpen, showShortcuts])

  const setWalkOverlaySuppressed = useCallback((_suppressed: boolean) => {
    // Intentionally no-op for debugging: avoid any custom overlay movement logic.
  }, [])

  const applyNavigationMode = useCallback((viewer: IfcViewerAPI) => {
    applyNavigationControls(viewer, navigationModeRef.current)
  }, [])

  const stopWalkMovementLoop = useCallback(() => {
    if (walkFrameRef.current !== null) {
      cancelAnimationFrame(walkFrameRef.current)
      walkFrameRef.current = null
    }
    walkLastTimestampRef.current = null
    walkKeyStateRef.current = { ...emptyWalkKeyState }
    walkHeadingRef.current.set(0, 0, -1)
    walkMoveActiveRef.current = false
    walkLookActiveRef.current = false
    walkLookPointerIdRef.current = null
    walkLookLastPointerRef.current = null
    walkDragActiveRef.current = false
    walkDragPointerIdRef.current = null
    walkDragLastPointerRef.current = null
    setWalkOverlaySuppressed(false)
  }, [setWalkOverlaySuppressed])

  const updateWalkLookByDelta = useCallback((deltaX: number, deltaY: number): boolean => {
    const viewer = viewerRef.current
    const controls = viewer?.context?.ifcCamera?.cameraControls as
      | {
          getPosition?: (out: Vector3) => void
          getTarget?: (out: Vector3) => void
          setLookAt?: (
            positionX: number,
            positionY: number,
            positionZ: number,
            targetX: number,
            targetY: number,
            targetZ: number,
            enableTransition?: boolean
          ) => void
        }
      | undefined
    if (!controls?.getPosition || !controls?.getTarget || !controls?.setLookAt) return false

    const position = new Vector3()
    const target = new Vector3()
    controls.getPosition(position)
    controls.getTarget(target)

    const direction = target.sub(position)
    if (direction.lengthSq() <= 1e-8) {
      direction.copy(walkHeadingRef.current)
      if (direction.lengthSq() <= 1e-8) {
        direction.set(0, 0, -1)
      }
    }
    direction.normalize()

    const currentPitch = Math.asin(Math.max(-1, Math.min(1, direction.y)))
    const currentYaw = Math.atan2(direction.x, direction.z)
    const nextYaw = currentYaw - deltaX * WALK_LOOK_SENSITIVITY
    const nextPitch = Math.max(
      -WALK_PITCH_LIMIT,
      Math.min(WALK_PITCH_LIMIT, currentPitch - deltaY * WALK_LOOK_SENSITIVITY)
    )
    const cosPitch = Math.cos(nextPitch)
    const nextDirection = new Vector3(
      Math.sin(nextYaw) * cosPitch,
      Math.sin(nextPitch),
      Math.cos(nextYaw) * cosPitch
    ).normalize()

    const horizontalDirection = new Vector3(nextDirection.x, 0, nextDirection.z)
    if (horizontalDirection.lengthSq() > 1e-8) {
      horizontalDirection.normalize()
      walkHeadingRef.current.copy(horizontalDirection)
    }

    const nextTarget = position.clone().add(nextDirection)
    controls.setLookAt(
      position.x,
      position.y,
      position.z,
      nextTarget.x,
      nextTarget.y,
      nextTarget.z,
      false
    )
    return true
  }, [viewerRef])

  const closeInsertMenu = useCallback(() => {
    setIsInsertMenuOpen(false)
    setInsertMenuAnchor(null)
    setInsertTargetCoords(null)
  }, [])

  const closePickMenu = useCallback(() => {
    setIsPickMenuOpen(false)
    setPickMenuAnchor(null)
    setPickCandidates([])
    setPickCandidateTypes({})
  }, [])

  const teleportCameraToPoint = useCallback((point: Point3D | null) => {
    if (!point) return false
    const viewer = viewerRef.current
    const controls = viewer?.context?.ifcCamera?.cameraControls as
      | {
          getPosition?: (out: Vector3) => void
          getTarget?: (out: Vector3) => void
          setLookAt?: (
            positionX: number,
            positionY: number,
            positionZ: number,
            targetX: number,
            targetY: number,
            targetZ: number,
            enableTransition?: boolean
          ) => void
        }
      | undefined
    if (!controls?.getPosition || !controls?.getTarget || !controls?.setLookAt) return false

    const currentPosition = new Vector3()
    const currentTarget = new Vector3()
    controls.getPosition(currentPosition)
    controls.getTarget(currentTarget)

    const nextTarget = new Vector3(point.x, point.y, point.z)
    const translation = nextTarget.clone().sub(currentTarget)
    currentPosition.add(translation)

    controls.setLookAt(
      currentPosition.x,
      currentPosition.y,
      currentPosition.z,
      nextTarget.x,
      nextTarget.y,
      nextTarget.z,
      false
    )
    return true
  }, [viewerRef])

  const moveCameraToPoint = useCallback((point: Point3D | null) => {
    if (!point) return false
    const viewer = viewerRef.current
    const controls = viewer?.context?.ifcCamera?.cameraControls as
      | {
          getPosition?: (out: Vector3) => void
          getTarget?: (out: Vector3) => void
          setPosition?: (x: number, y: number, z: number, enableTransition?: boolean) => void
          setTarget?: (x: number, y: number, z: number, enableTransition?: boolean) => void
          setLookAt?: (
            positionX: number,
            positionY: number,
            positionZ: number,
            targetX: number,
            targetY: number,
            targetZ: number,
            enableTransition?: boolean
          ) => void
        }
      | undefined
    if (!controls) return false

    if (typeof controls.getPosition === 'function' && typeof controls.getTarget === 'function') {
      const currentPosition = new Vector3()
      const currentTarget = new Vector3()
      controls.getPosition(currentPosition)
      controls.getTarget(currentTarget)

      const viewDirection = currentTarget.sub(currentPosition)
      if (viewDirection.lengthSq() <= 1e-8) {
        viewDirection.set(0, 0, -1)
      }

      const nextPosition = new Vector3(point.x, point.y, point.z)
      const nextTarget = nextPosition.clone().add(viewDirection)

      if (typeof controls.setLookAt === 'function') {
        controls.setLookAt(
          nextPosition.x,
          nextPosition.y,
          nextPosition.z,
          nextTarget.x,
          nextTarget.y,
          nextTarget.z,
          false
        )
        return true
      }

      if (typeof controls.setPosition === 'function' && typeof controls.setTarget === 'function') {
        controls.setPosition(nextPosition.x, nextPosition.y, nextPosition.z, false)
        controls.setTarget(nextTarget.x, nextTarget.y, nextTarget.z, false)
        return true
      }
    }

    if (typeof controls.setPosition === 'function' && typeof controls.setTarget === 'function') {
      controls.setPosition(point.x, point.y, point.z, false)
      controls.setTarget(point.x, point.y, point.z - 1, false)
      return true
    }

    if (typeof controls.setLookAt === 'function') {
      controls.setLookAt(point.x, point.y, point.z, point.x, point.y, point.z - 1, false)
      return true
    }

    return false
  }, [viewerRef])

  const moveCameraAlongView = useCallback((rawWheelDelta: number) => {
    const viewer = viewerRef.current
    const controls = viewer?.context?.ifcCamera?.cameraControls as
      | {
          getPosition?: (out: Vector3) => void
          getTarget?: (out: Vector3) => void
          setPosition?: (x: number, y: number, z: number, enableTransition?: boolean) => void
          setTarget?: (x: number, y: number, z: number, enableTransition?: boolean) => void
          setLookAt?: (
            positionX: number,
            positionY: number,
            positionZ: number,
            targetX: number,
            targetY: number,
            targetZ: number,
            enableTransition?: boolean
          ) => void
        }
      | undefined
    if (!controls?.getPosition || !controls?.getTarget) return false

    const wheelDelta = Math.max(-FREE_WHEEL_MAX_DELTA, Math.min(FREE_WHEEL_MAX_DELTA, rawWheelDelta))
    if (Math.abs(wheelDelta) < 1e-6) return false

    const position = new Vector3()
    const target = new Vector3()
    controls.getPosition(position)
    controls.getTarget(target)

    const direction = target.clone().sub(position)
    if (direction.lengthSq() <= 1e-8) return false
    direction.normalize()

    const move = direction.multiplyScalar(-wheelDelta * FREE_WHEEL_MOVE_FACTOR)
    const nextPosition = position.clone().add(move)
    const nextTarget = target.clone().add(move)

    if (typeof controls.setLookAt === 'function') {
      controls.setLookAt(
        nextPosition.x,
        nextPosition.y,
        nextPosition.z,
        nextTarget.x,
        nextTarget.y,
        nextTarget.z,
        false
      )
      return true
    }

    if (typeof controls.setPosition === 'function' && typeof controls.setTarget === 'function') {
      controls.setPosition(nextPosition.x, nextPosition.y, nextPosition.z, false)
      controls.setTarget(nextTarget.x, nextTarget.y, nextTarget.z, false)
      return true
    }

    return false
  }, [viewerRef])

  const pickMenuItems = useMemo(
    () =>
      pickCandidates.map((candidate) => ({
        id: `${candidate.modelID}:${candidate.expressID}`,
        label: `#${candidate.expressID}`,
        meta: pickCandidateTypes[`${candidate.modelID}:${candidate.expressID}`]
      })),
    [pickCandidateTypes, pickCandidates]
  )

  const pickMenuLookup = useMemo(
    () => new Map(pickCandidates.map((candidate) => [`${candidate.modelID}:${candidate.expressID}`, candidate])),
    [pickCandidates]
  )

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

    const viewer = viewerRef.current
    if (!viewer) {
      setPickCandidateTypes({})
      return
    }

    const token = ++pickTypeRequestRef.current
    const fallbackEntries = pickCandidates.map((candidate) => [
      `${candidate.modelID}:${candidate.expressID}`,
      candidate.kind === 'custom' ? 'custom cube' : 'ifc element'
    ])
    setPickCandidateTypes(Object.fromEntries(fallbackEntries))
    const resolveTypes = async () => {
      const entries = await Promise.all(
        pickCandidates.map(async (candidate) => {
          const key = `${candidate.modelID}:${candidate.expressID}`
          if (candidate.kind === 'custom') {
            return [key, 'custom cube'] as const
          }
          try {
            const manager = viewer.IFC?.loader?.ifcManager as
              | { getIfcType?: (modelID: number, id: number) => string | undefined }
              | undefined
            const directType = manager?.getIfcType?.(candidate.modelID, candidate.expressID)
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
      if (pickTypeRequestRef.current !== token) return
      setPickCandidateTypes(Object.fromEntries(entries))
    }

    void resolveTypes()
  }, [isPickMenuOpen, pickCandidates, viewerRef])

  const finishRotateMode = useCallback(
    (options?: { commit?: boolean; revert?: boolean }) => {
      const shouldCommit = options?.commit ?? false
      const shouldRevert = options?.revert ?? false
      const start = rotateStartValueRef.current
      const current = rotateCurrentValueRef.current

      if (shouldRevert && start) {
        rotateSelectedTo(start)
      } else if (shouldCommit && start && current) {
        const changed =
          Math.abs(current.x - start.x) >= ROTATION_EPSILON ||
          Math.abs(current.y - start.y) >= ROTATION_EPSILON ||
          Math.abs(current.z - start.z) >= ROTATION_EPSILON
        if (changed) {
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

  const finishDragMode = useCallback(
    (options?: { commit?: boolean; revert?: boolean }) => {
      const shouldCommit = options?.commit ?? false
      const shouldRevert = options?.revert ?? false
      const startOffset = dragModeStartOffsetRef.current

      if (shouldRevert && startOffset) {
        moveSelectedTo(startOffset)
      } else if (shouldCommit && startOffset) {
        const changed =
          Math.abs(offsetInputs.dx - startOffset.dx) >= 1e-6 ||
          Math.abs(offsetInputs.dy - startOffset.dy) >= 1e-6 ||
          Math.abs(offsetInputs.dz - startOffset.dz) >= 1e-6
        if (changed) {
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

  const updateHoverCoords = useCallback(() => {
    const viewer = viewerRef.current
    if (!viewer) return

    const hit = viewer.context.castRayIfc()
    if (hit?.point) {
      setHoverCoords({
        x: hit.point.x,
        y: hit.point.y,
        z: hit.point.z
      })
    } else {
      setHoverCoords(null)
    }
  }, [viewerRef])

  useEffect(() => {
    const viewer = viewerRef.current ?? ensureViewer()
    if (!viewer) return
    applyNavigationControls(viewer, navigationMode)
    if (!isWalkMode) {
      stopWalkMovementLoop()
    }
  }, [ensureViewer, isWalkMode, navigationMode, stopWalkMovementLoop, viewerRef])

  useEffect(() => {
    if (!isWalkMode) return

    const up = new Vector3(0, 1, 0)
    const position = new Vector3()
    const target = new Vector3()
    const forward = new Vector3()
    const right = new Vector3()
    const move = new Vector3()

    const tick = (timestamp: number) => {
      const viewer = viewerRef.current
      const controls = viewer?.context?.ifcCamera?.cameraControls
      if (!controls || typeof controls.getPosition !== 'function' || typeof controls.getTarget !== 'function') {
        walkFrameRef.current = requestAnimationFrame(tick)
        return
      }

      const lastTimestamp = walkLastTimestampRef.current ?? timestamp
      walkLastTimestampRef.current = timestamp
      const deltaTime = Math.min((timestamp - lastTimestamp) / 1000, 0.05)

      const keys = walkKeyStateRef.current
      const forwardInput = (keys.arrowup ? 1 : 0) - (keys.arrowdown ? 1 : 0)
      const strafeInput = (keys.arrowright ? 1 : 0) - (keys.arrowleft ? 1 : 0)
      const isMoving = forwardInput !== 0 || strafeInput !== 0

      if (walkMoveActiveRef.current !== isMoving) {
        walkMoveActiveRef.current = isMoving
        setWalkOverlaySuppressed(isMoving || walkDragActiveRef.current || walkLookActiveRef.current)
      }

      if (deltaTime > 0 && isMoving) {
        controls.getPosition(position)
        controls.getTarget(target)

        forward.subVectors(target, position)
        forward.y = 0
        if (forward.lengthSq() > 1e-8) {
          forward.normalize()
          walkHeadingRef.current.copy(forward)
        } else {
          forward.copy(walkHeadingRef.current)
        }

        right.crossVectors(forward, up).normalize()

        move.set(0, 0, 0)
        move.addScaledVector(forward, forwardInput)
        move.addScaledVector(right, strafeInput)
        if (move.lengthSq() > 1e-8) {
          move.normalize().multiplyScalar(WALK_MOVE_SPEED * deltaTime)
          position.add(move)
          target.add(move)
          controls.setLookAt(
            position.x,
            position.y,
            position.z,
            target.x,
            target.y,
            target.z,
            false
          )
        }
      }

      walkFrameRef.current = requestAnimationFrame(tick)
    }

    walkFrameRef.current = requestAnimationFrame(tick)
    return () => {
      stopWalkMovementLoop()
    }
  }, [isWalkMode, setWalkOverlaySuppressed, stopWalkMovementLoop, viewerRef])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const handlePointerDown = (event: PointerEvent) => {
      if (!isWalkMode) return
      if (event.button === 1) {
        walkLookActiveRef.current = true
        walkLookPointerIdRef.current = event.pointerId
        walkLookLastPointerRef.current = { x: event.clientX, y: event.clientY }
      } else if (event.button === 2) {
        walkDragActiveRef.current = true
        walkDragPointerIdRef.current = event.pointerId
        walkDragLastPointerRef.current = { x: event.clientX, y: event.clientY }
      } else {
        return
      }
      setWalkOverlaySuppressed(true)
      try {
        container.setPointerCapture(event.pointerId)
      } catch {
        // Ignore capture errors for unsupported platforms.
      }
      event.preventDefault()
    }

    const handlePointerMove = (event: PointerEvent) => {
      if (!isWalkMode) return

      const isLookPointer =
        walkLookActiveRef.current &&
        (walkLookPointerIdRef.current === null || event.pointerId === walkLookPointerIdRef.current)
      if (isLookPointer) {
        const lastPointer = walkLookLastPointerRef.current
        walkLookLastPointerRef.current = { x: event.clientX, y: event.clientY }
        if (!lastPointer) return
        const deltaX = event.clientX - lastPointer.x
        const deltaY = event.clientY - lastPointer.y
        if (deltaX === 0 && deltaY === 0) return
        updateWalkLookByDelta(deltaX, deltaY)
        event.preventDefault()
        return
      }

      const isDragPointer =
        walkDragActiveRef.current &&
        (walkDragPointerIdRef.current === null || event.pointerId === walkDragPointerIdRef.current)
      if (!isDragPointer) return

      const lastPointer = walkDragLastPointerRef.current
      walkDragLastPointerRef.current = { x: event.clientX, y: event.clientY }
      if (!lastPointer) return

      const deltaX = event.clientX - lastPointer.x
      const deltaY = event.clientY - lastPointer.y
      if (deltaX === 0 && deltaY === 0) return

      const viewer = viewerRef.current
      const controls = viewer?.context?.ifcCamera?.cameraControls as
        | {
            getPosition?: (out: Vector3) => void
            getTarget?: (out: Vector3) => void
            setLookAt?: (
              positionX: number,
              positionY: number,
              positionZ: number,
              targetX: number,
              targetY: number,
              targetZ: number,
              enableTransition?: boolean
            ) => void
          }
        | undefined
      if (!controls?.getPosition || !controls?.getTarget || !controls?.setLookAt) return

      const position = new Vector3()
      const target = new Vector3()
      const forward = new Vector3()
      const right = new Vector3()
      const up = new Vector3(0, 1, 0)
      controls.getPosition(position)
      controls.getTarget(target)

      forward.subVectors(target, position)
      forward.y = 0
      if (forward.lengthSq() > 1e-8) {
        forward.normalize()
        walkHeadingRef.current.copy(forward)
      } else {
        forward.copy(walkHeadingRef.current)
      }
      right.crossVectors(forward, up).normalize()

      const move = new Vector3()
      move.addScaledVector(right, deltaX * WALK_DRAG_MOVE_PER_PIXEL)
      move.addScaledVector(forward, -deltaY * WALK_DRAG_MOVE_PER_PIXEL)
      position.add(move)
      target.add(move)

      controls.setLookAt(
        position.x,
        position.y,
        position.z,
        target.x,
        target.y,
        target.z,
        false
      )
      event.preventDefault()
    }

    const stopLook = (event?: PointerEvent) => {
      if (event && event.button !== 1) return
      if (event && walkLookPointerIdRef.current !== null && event.pointerId !== walkLookPointerIdRef.current) {
        return
      }
      const pointerId = walkLookPointerIdRef.current
      walkLookActiveRef.current = false
      walkLookPointerIdRef.current = null
      walkLookLastPointerRef.current = null
      setWalkOverlaySuppressed(walkMoveActiveRef.current || walkDragActiveRef.current)
      if (pointerId !== null) {
        try {
          container.releasePointerCapture(pointerId)
        } catch {
          // Ignore release errors for unsupported platforms.
        }
      }
    }

    const stopDragMove = (event?: PointerEvent) => {
      if (event && event.button !== 2) return
      if (event && walkDragPointerIdRef.current !== null && event.pointerId !== walkDragPointerIdRef.current) {
        return
      }
      const pointerId = walkDragPointerIdRef.current
      walkDragActiveRef.current = false
      walkDragPointerIdRef.current = null
      walkDragLastPointerRef.current = null
      setWalkOverlaySuppressed(walkMoveActiveRef.current || walkLookActiveRef.current)
      if (pointerId !== null) {
        try {
          container.releasePointerCapture(pointerId)
        } catch {
          // Ignore release errors for unsupported platforms.
        }
      }
    }

    const handleContextMenu = (event: MouseEvent) => {
      if (!isWalkMode) return
      event.preventDefault()
    }

    const handleWindowBlur = () => {
      stopLook()
      stopDragMove()
    }

    container.addEventListener('pointerdown', handlePointerDown)
    container.addEventListener('pointermove', handlePointerMove)
    container.addEventListener('contextmenu', handleContextMenu)
    window.addEventListener('pointerup', stopLook)
    window.addEventListener('pointerup', stopDragMove)
    window.addEventListener('blur', handleWindowBlur)
    return () => {
      container.removeEventListener('pointerdown', handlePointerDown)
      container.removeEventListener('pointermove', handlePointerMove)
      container.removeEventListener('contextmenu', handleContextMenu)
      window.removeEventListener('pointerup', stopLook)
      window.removeEventListener('pointerup', stopDragMove)
      window.removeEventListener('blur', handleWindowBlur)
      stopLook()
      stopDragMove()
    }
  }, [containerRef, isWalkMode, setWalkOverlaySuppressed, updateWalkLookByDelta, viewerRef])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const handleSelectClick = (clientX: number, clientY: number) => {
      const rect = container.getBoundingClientRect()
      const candidates = pickCandidatesAt(clientX, clientY, container, 0.02)

      if (candidates.length > 1) {
        setPickCandidates(candidates)
        setIsPickMenuOpen(true)
        setPickMenuAnchor({
          x: Math.max(0, Math.min(clientX - rect.left + 12, rect.width - 12)),
          y: Math.max(0, Math.min(clientY - rect.top + 12, rect.height - 12))
        })
        return
      }

      if (candidates.length === 1) {
        closePickMenu()
        const only = candidates[0]
        if (only.kind === 'custom') {
          selectCustomCube(only.expressID)
        } else {
          void selectById(only.modelID, only.expressID, { autoFocus: false })
        }
        return
      }

      closePickMenu()
      resetSelection()
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return
      if (isDragging) {
        suppressNextSelectionClickRef.current = true
        finishDragMode({ commit: true })
        event.preventDefault()
        return
      }
      if (isRotating) {
        suppressNextSelectionClickRef.current = true
        finishRotateMode({ commit: true })
        event.preventDefault()
      }
    }

    const handleClick = (event: MouseEvent) => {
      if (event.button !== 0) return
      if (suppressNextSelectionClickRef.current) {
        suppressNextSelectionClickRef.current = false
        event.preventDefault()
        return
      }
      handleSelectClick(event.clientX, event.clientY)
      event.preventDefault()
    }

    container.addEventListener('pointerdown', handlePointerDown)
    container.addEventListener('click', handleClick)
    return () => {
      container.removeEventListener('pointerdown', handlePointerDown)
      container.removeEventListener('click', handleClick)
    }
  }, [
    closePickMenu,
    containerRef,
    finishDragMode,
    finishRotateMode,
    isDragging,
    isRotating,
    pickCandidatesAt,
    resetSelection,
    selectById,
    selectCustomCube
  ])

  useEffect(() => {
    if (isWalkMode) return
    const container = containerRef.current
    if (!container) return

    const handleWheel = (event: WheelEvent) => {
      if (event.ctrlKey || event.metaKey) return
      const deltaMultiplier = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 120 : 1
      const normalizedDelta = event.deltaY * deltaMultiplier
      const changed = moveCameraAlongView(normalizedDelta)
      if (changed) {
        event.preventDefault()
      }
    }

    container.addEventListener('wheel', handleWheel, { passive: false })
    return () => {
      container.removeEventListener('wheel', handleWheel)
    }
  }, [containerRef, isWalkMode, moveCameraAlongView])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const handlePointerMove = (event: PointerEvent) => {
      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect()
        lastPointerPosRef.current = {
          x: Math.max(0, Math.min(event.clientX - rect.left, rect.width)),
          y: Math.max(0, Math.min(event.clientY - rect.top, rect.height))
        }
      }
      if (isRotating) {
        const startPointer = rotateStartPointerRef.current
        const startRotation = rotateStartValueRef.current
        if (!startPointer || !startRotation) {
          return
        }
        const deltaX = event.clientX - startPointer.x
        const deltaY = event.clientY - startPointer.y
        const nextRotation = {
          x: startRotation.x,
          y: startRotation.y,
          z: startRotation.z
        }
        if (rotateAxisLock === 'x') {
          nextRotation.x += deltaY * ROTATE_DRAG_SENSITIVITY
        } else if (rotateAxisLock === 'y') {
          nextRotation.y += deltaX * ROTATE_DRAG_SENSITIVITY
        } else if (rotateAxisLock === 'z') {
          nextRotation.z += deltaX * ROTATE_DRAG_SENSITIVITY
        } else {
          nextRotation.x += deltaY * ROTATE_DRAG_SENSITIVITY
          nextRotation.y += deltaX * ROTATE_DRAG_SENSITIVITY
        }
        rotateCurrentValueRef.current = nextRotation
        rotateSelectedTo(nextRotation)
        event.preventDefault()
      } else if (isDragging) {
        const viewer = viewerRef.current
        const plane = dragPlaneRef.current
        if (viewer && plane && containerRef.current) {
          const rect = containerRef.current.getBoundingClientRect()
          const ndc = new Vector2(
            ((event.clientX - rect.left) / rect.width) * 2 - 1,
            -((event.clientY - rect.top) / rect.height) * 2 + 1
          )
          const raycaster = new Raycaster()
          raycaster.setFromCamera(ndc, viewer.context.getCamera())
          const hitPoint = new Vector3()
          const ok = raycaster.ray.intersectPlane(plane, hitPoint)
          if (ok && dragStartPointRef.current && dragStartOffsetRef.current) {
            const delta = hitPoint.clone().sub(dragStartPointRef.current)
            if (dragAxisLock === 'x') {
              delta.y = 0
              delta.z = 0
            } else if (dragAxisLock === 'y') {
              delta.x = 0
              delta.z = 0
            } else if (dragAxisLock === 'z') {
              delta.x = 0
              delta.y = 0
            }
            const newOffset = {
              dx: dragStartOffsetRef.current.dx + delta.x,
              dy: dragStartOffsetRef.current.dy + delta.y,
              dz: dragStartOffsetRef.current.dz + delta.z
            }
            moveSelectedTo(newOffset)
          }
        }
      } else {
        updateHoverCoords()
      }
    }

    container.addEventListener('pointermove', handlePointerMove)
    return () => {
      container.removeEventListener('pointermove', handlePointerMove)
    }
  }, [
    containerRef,
    dragAxisLock,
    isDragging,
    isRotating,
    moveSelectedTo,
    rotateAxisLock,
    rotateSelectedTo,
    updateHoverCoords,
    viewerRef
  ])

  useEffect(() => {
    const isEditableTarget = (target: EventTarget | null) => {
      const element = target as HTMLElement | null
      if (!element) return false
      const tagName = element.tagName
      return element.isContentEditable || tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT'
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target)) return
      const key = event.key.toLowerCase()
      const walkMoveKey = getWalkMoveKey(event)

      if (isWalkMode && walkMoveKey) {
        walkKeyStateRef.current[walkMoveKey] = true
        event.preventDefault()
        return
      }

      if (showShortcuts && (event.key === '?' || event.key.toLowerCase() === 'h')) {
        setIsShortcutsOpen((prev) => !prev)
        return
      }
      if (key === 'm') {
        toggleNavigationMode()
        return
      }
      if (key === 'r') {
        if (!selectedElement || !canTransformSelected) return
        const container = containerRef.current
        if (container) {
          const rect = container.getBoundingClientRect()
          rotateStartPointerRef.current = {
            x: rect.left + lastPointerPosRef.current.x,
            y: rect.top + lastPointerPosRef.current.y
          }
        } else {
          rotateStartPointerRef.current = { x: 0, y: 0 }
        }
        const startRotation =
          getIfcElementRotationDelta(selectedElement.modelID, selectedElement.expressID) ?? {
            x: 0,
            y: 0,
            z: 0
          }
        rotateStartValueRef.current = {
          x: startRotation.x,
          y: startRotation.y,
          z: startRotation.z
        }
        rotateCurrentValueRef.current = {
          x: startRotation.x,
          y: startRotation.y,
          z: startRotation.z
        }
        setIsDragging(false)
        setDragAxisLock(null)
        dragPlaneRef.current = null
        dragStartPointRef.current = null
        dragStartOffsetRef.current = null
        setIsRotating(true)
        setRotateAxisLock(null)
        event.preventDefault()
        return
      }
      if (!isWalkMode && key === 'a') {
        const container = containerRef.current
        if (container) {
          const rect = container.getBoundingClientRect()
          const x = Math.max(0, Math.min(lastPointerPosRef.current.x, rect.width))
          const y = Math.max(0, Math.min(lastPointerPosRef.current.y, rect.height))
          setInsertMenuAnchor({
            x: x + 12,
            y: y - 4
          })
        } else {
          setInsertMenuAnchor({ x: 16, y: 16 })
        }
        const viewer = viewerRef.current
        const hit = viewer?.context.castRayIfc()
        const point =
          hit?.point ??
          hoverCoords ?? {
            x: 0,
            y: 0,
            z: 0
          }
        setInsertTargetCoords(point ? { x: point.x, y: point.y, z: point.z } : null)
        setIsInsertMenuOpen(true)
      }
      if (key === 'g') {
        if (!selectedElement || !canTransformSelected) return
        const viewer = viewerRef.current
        const currentPos = getSelectedWorldPosition()
        if (!viewer || !currentPos) return
        const camera = viewer.context.getCamera()
        const normal = new Vector3()
        camera.getWorldDirection(normal)
        let startPoint = currentPos
        if (selectedElement.modelID !== CUSTOM_CUBE_MODEL_ID) {
          const hit = viewer.context.castRayIfc()
          if (hit?.point) {
            startPoint = hit.point
          }
        }
        const plane = new Plane().setFromNormalAndCoplanarPoint(normal, startPoint)
        dragPlaneRef.current = plane
        dragStartPointRef.current = startPoint.clone()
        dragStartOffsetRef.current = {
          dx: offsetInputs.dx,
          dy: offsetInputs.dy,
          dz: offsetInputs.dz
        }
        dragModeStartOffsetRef.current = {
          dx: offsetInputs.dx,
          dy: offsetInputs.dy,
          dz: offsetInputs.dz
        }
        setIsDragging(true)
        setDragAxisLock(null)
      }
      if (isDragging && key === 'f') {
        const viewer = viewerRef.current
        const currentPos = getSelectedWorldPosition()
        if (!viewer || !currentPos) return
        const normal = new Vector3(0, 1, 0)
        const plane = new Plane().setFromNormalAndCoplanarPoint(normal, currentPos)
        let startPoint = currentPos.clone()
        const container = containerRef.current
        if (container) {
          const rect = container.getBoundingClientRect()
          const ndc = new Vector2(
            (lastPointerPosRef.current.x / rect.width) * 2 - 1,
            -(lastPointerPosRef.current.y / rect.height) * 2 + 1
          )
          const raycaster = new Raycaster()
          raycaster.setFromCamera(ndc, viewer.context.getCamera())
          const hitPoint = new Vector3()
          const hit = raycaster.ray.intersectPlane(plane, hitPoint)
          if (hit) {
            startPoint = hitPoint
          }
        }
        dragPlaneRef.current = plane
        dragStartPointRef.current = startPoint.clone()
        dragStartOffsetRef.current = {
          dx: offsetInputs.dx,
          dy: offsetInputs.dy,
          dz: offsetInputs.dz
        }
        setDragAxisLock(null)
      }
      if (isRotating && (key === 'x' || key === 'y' || key === 'z')) {
        setRotateAxisLock(key as 'x' | 'y' | 'z')
      }
      if (isDragging && (key === 'x' || key === 'y' || key === 'z')) {
        setDragAxisLock(key as 'x' | 'y' | 'z')
      }
      if (event.key === 'Escape') {
        closeInsertMenu()
        finishDragMode({ revert: true })
        finishRotateMode({ revert: true })
        setIsShortcutsOpen(false)
        closePickMenu()
      }
    }

    const handleKeyUp = (event: KeyboardEvent) => {
      const walkMoveKey = getWalkMoveKey(event)
      if (walkMoveKey) {
        walkKeyStateRef.current[walkMoveKey] = false
      }
    }

    const handleWindowBlur = () => {
      walkKeyStateRef.current = { ...emptyWalkKeyState }
      if (isDragging) {
        finishDragMode({ revert: true })
      }
      if (isRotating) {
        finishRotateMode({ revert: true })
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)
    window.addEventListener('blur', handleWindowBlur)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
      window.removeEventListener('blur', handleWindowBlur)
    }
  }, [
    canTransformSelected,
    closeInsertMenu,
    closePickMenu,
    containerRef,
    finishDragMode,
    finishRotateMode,
    getIfcElementRotationDelta,
    getSelectedWorldPosition,
    hoverCoords,
    isDragging,
    isRotating,
    isWalkMode,
    offsetInputs,
    selectedElement,
    showShortcuts,
    toggleNavigationMode,
    viewerRef
  ])

  useEffect(() => {
    if (canTransformSelected) return
    if (isRotating) {
      finishRotateMode({ revert: true })
    }
    if (isDragging) {
      finishDragMode({ revert: true })
    }
  }, [canTransformSelected, finishDragMode, finishRotateMode, isDragging, isRotating])

  return {
    navigationMode,
    isWalkMode,
    toggleNavigationMode,
    applyNavigationMode,
    stopWalkMovementLoop,
    hoverCoords,
    isInsertMenuOpen,
    insertMenuAnchor,
    insertTargetCoords,
    closeInsertMenu,
    isShortcutsOpen,
    setIsShortcutsOpen,
    isPickMenuOpen,
    pickMenuAnchor,
    pickMenuItems,
    closePickMenu,
    handlePickMenuSelect,
    moveCameraToPoint,
    teleportCameraToPoint
  }
}
