import { type Dispatch, type MutableRefObject, type SetStateAction, useCallback, useEffect, useMemo } from 'react'
import {
  buildRoomOptions,
  buildTreeNodeSelectionMap,
  isTreeNodeEditableWithinRoom,
  resolveContainingRoomNodeId,
  type RoomListEntry
} from './ifcViewer.rooms'
import type { ObjectTree, SelectedElement } from './ifcViewerTypes'
import type { StoreyInfo } from './ifcRoomTree.utils'

type UseIfcViewerRoomStateArgs = {
  tree: ObjectTree
  storeyInfoByNodeId: Record<string, StoreyInfo>
  roomNumbersRef: MutableRefObject<Map<number, string>>
  selectedElement: SelectedElement | null
  roomOnlyTransformGuard: boolean
  lastWalkRoomNodeId: string | null
  lastWalkRoomNodeIdSetter: Dispatch<SetStateAction<string | null>>
}

// Derives room lists, selection-to-tree lookup, and room-only edit guards from the current IFC tree.
export const useIfcViewerRoomState = ({
  tree,
  storeyInfoByNodeId,
  roomNumbersRef,
  selectedElement,
  roomOnlyTransformGuard,
  lastWalkRoomNodeId,
  lastWalkRoomNodeIdSetter
}: UseIfcViewerRoomStateArgs) => {
  // This builds the room list shown by the side panel from the current IFC tree and storey labels.
  const roomOptions = useMemo<RoomListEntry[]>(
    () =>
      buildRoomOptions({
        tree,
        storeyInfoByNodeId,
        roomNumbers: roomNumbersRef.current
      }),
    [storeyInfoByNodeId, tree, roomNumbersRef]
  )

  // This indexes IFC tree nodes by the model/express id pairs used by viewer selection.
  const treeNodeBySelectionKey = useMemo(() => buildTreeNodeSelectionMap(tree.nodes), [tree.nodes])

  // This resolves the tree node that matches one currently selected IFC element.
  const resolveTreeNodeIdForSelection = useCallback(
    (modelID: number, expressID: number): string | null => {
      return treeNodeBySelectionKey.get(`${modelID}:${expressID}`) ?? null
    },
    [treeNodeBySelectionKey]
  )

  // This resolves the nearest containing room node for one tree node id.
  const resolveContainingRoomNodeIdForTree = useCallback(
    (nodeId: string | null | undefined): string | null => resolveContainingRoomNodeId(tree.nodes, nodeId),
    [tree.nodes]
  )

  // This maps the active IFC selection onto its matching tree node id when possible.
  const selectedTransformNodeId = useMemo(() => {
    if (!selectedElement) return null
    return resolveTreeNodeIdForSelection(selectedElement.modelID, selectedElement.expressID)
  }, [resolveTreeNodeIdForSelection, selectedElement])

  // This decides whether the current selection may be moved or rotated under room-only edit mode.
  const canTransformSelected = useMemo(() => {
    if (!selectedElement) return false
    if (!roomOnlyTransformGuard) return true
    return isTreeNodeEditableWithinRoom(tree.nodes, selectedTransformNodeId)
  }, [roomOnlyTransformGuard, selectedElement, selectedTransformNodeId, tree.nodes])

  // This exposes a human-readable reason when room-only edit mode blocks the current selection.
  const transformGuardReason = useMemo(() => {
    if (!roomOnlyTransformGuard || !selectedElement || canTransformSelected) return null
    return 'Movement and rotation are locked for elements outside rooms.'
  }, [canTransformSelected, roomOnlyTransformGuard, selectedElement])

  // This indexes room entries by node id so the side panel can resolve active room contents quickly.
  const roomOptionsByNodeId = useMemo(
    () => new Map(roomOptions.map((room) => [room.nodeId, room])),
    [roomOptions]
  )

  // This resolves the currently active room entry used by the room contents tab.
  const walkRoomContents = useMemo(() => {
    if (!lastWalkRoomNodeId) return null
    return roomOptionsByNodeId.get(lastWalkRoomNodeId) ?? null
  }, [lastWalkRoomNodeId, roomOptionsByNodeId])

  // This clears the remembered active room when its tree node disappears after a rebuild.
  useEffect(() => {
    if (!lastWalkRoomNodeId) return
    if (tree.nodes[lastWalkRoomNodeId]) return
    lastWalkRoomNodeIdSetter(null)
  }, [lastWalkRoomNodeId, lastWalkRoomNodeIdSetter, tree.nodes])

  return {
    roomOptions,
    walkRoomContents,
    canTransformSelected,
    transformGuardReason,
    resolveTreeNodeIdForSelection,
    resolveContainingRoomNodeIdForTree
  }
}
