import { useCallback, useEffect, useImperativeHandle, useRef, type Dispatch, type ForwardedRef, type MutableRefObject, type SetStateAction } from 'react'
import type { ViewerState } from './ifcViewerTypes'
import { captureViewerCameraState, type NavigationMode, restoreViewerCameraState } from './hooks/viewerInteractions.camera'
import type { IfcViewerAPI } from './viewer/IfcViewerAPICompat'

export type IfcViewerHandle = {
  captureViewerState: () => ViewerState | null
}

type UseIfcViewerSessionStateArgs = {
  ref: ForwardedRef<IfcViewerHandle>
  viewerRef: MutableRefObject<IfcViewerAPI | null>
  activeModelId: number | null
  sourceKey: string
  viewerState?: ViewerState | null
  navigationMode: NavigationMode
  setNavigationMode: Dispatch<SetStateAction<NavigationMode>>
  roomOnlyTransformGuard: boolean
  setRoomOnlyTransformGuard: Dispatch<SetStateAction<boolean>>
  isShortcutsOpen: boolean
  setIsShortcutsOpen: Dispatch<SetStateAction<boolean>>
}

// Returns true when the persisted viewer state contains at least one meaningful field to restore.
const hasPersistedViewerState = (viewerState: ViewerState | null | undefined): viewerState is ViewerState => {
  if (!viewerState) return false
  return Boolean(
    viewerState.navigationMode ||
      viewerState.roomOnlyTransformGuard !== undefined ||
      viewerState.shortcutsOpen !== undefined ||
      viewerState.cameraPosition ||
      viewerState.cameraTarget
  )
}

// Owns viewer session capture and restore so apply-state can round-trip camera and mode state.
export const useIfcViewerSessionState = ({
  ref,
  viewerRef,
  activeModelId,
  sourceKey,
  viewerState,
  navigationMode,
  setNavigationMode,
  roomOnlyTransformGuard,
  setRoomOnlyTransformGuard,
  isShortcutsOpen,
  setIsShortcutsOpen
}: UseIfcViewerSessionStateArgs) => {
  const lastAppliedSourceKeyRef = useRef<string | null>(null)

  // This function snapshots the current navigation and camera session state from the live viewer.
  const captureState = useCallback((): ViewerState | null => {
    const cameraState = captureViewerCameraState(viewerRef.current)
    return {
      navigationMode,
      roomOnlyTransformGuard,
      shortcutsOpen: isShortcutsOpen,
      cameraPosition: cameraState?.cameraPosition ?? null,
      cameraTarget: cameraState?.cameraTarget ?? null
    }
  }, [isShortcutsOpen, navigationMode, roomOnlyTransformGuard, viewerRef])

  // This imperative handle exposes one stable viewer-state snapshot method to the parent app shell.
  useImperativeHandle(
    ref,
    () => ({
      captureViewerState: captureState
    }),
    [captureState, ref]
  )

  // This effect invalidates the one-shot restore marker whenever a different model source becomes active.
  useEffect(() => {
    lastAppliedSourceKeyRef.current = null
  }, [sourceKey])

  // This effect restores saved camera and navigation session state once for each newly loaded model source.
  useEffect(() => {
    if (activeModelId === null || viewerState === undefined) return
    if (lastAppliedSourceKeyRef.current === sourceKey) return

    setNavigationMode(viewerState?.navigationMode === 'walk' ? 'walk' : 'free')
    setRoomOnlyTransformGuard(viewerState?.roomOnlyTransformGuard ?? true)
    setIsShortcutsOpen(Boolean(viewerState?.shortcutsOpen))

    if (hasPersistedViewerState(viewerState)) {
      restoreViewerCameraState(viewerRef.current, viewerState.cameraPosition, viewerState.cameraTarget)
    }

    lastAppliedSourceKeyRef.current = sourceKey
  }, [
    activeModelId,
    setIsShortcutsOpen,
    setNavigationMode,
    setRoomOnlyTransformGuard,
    sourceKey,
    viewerRef,
    viewerState
  ])
}
