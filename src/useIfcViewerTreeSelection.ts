import { type Dispatch, type SetStateAction, useCallback, useEffect } from 'react'
import { CUSTOM_CUBE_MODEL_ID } from './hooks/selectionOffsets.shared'
import { ROOM_SELECT_Y_OFFSET } from './ifcViewer.constants'
import { collectIfcIdsInSubtree } from './ifcViewer.rooms'
import type { ObjectTree, Point3D, SelectedElement } from './ifcViewerTypes'

type UseIfcViewerTreeSelectionArgs = {
  tree: ObjectTree
  selectedElement: SelectedElement | null
  selectedNodeIdSetter: Dispatch<SetStateAction<string | null>>
  lastWalkRoomNodeIdSetter: Dispatch<SetStateAction<string | null>>
  isWalkMode: boolean
  resolveTreeNodeIdForSelection: (modelID: number, expressID: number) => string | null
  resolveContainingRoomNodeIdForTree: (nodeId: string | null | undefined) => string | null
  clearIfcHighlight: () => void
  selectCustomCube: (expressID: number) => void
  selectById: (
    modelID: number,
    expressID: number,
    options?: { autoFocus?: boolean }
  ) => Promise<unknown>
  hasRenderableExpressId: (modelID: number, expressID: number) => boolean
  highlightIfcGroup: (
    modelID: number,
    expressIds: number[],
    options?: { anchorExpressID?: number }
  ) => void
  resetSelection: () => void
  resolveNodeInsertTarget: (
    nodeId: string,
    options?: { autoFocus?: boolean }
  ) => Promise<Point3D | null>
  moveCameraToPoint: (point: Point3D | null) => boolean
  teleportCameraToPoint: (point: Point3D | null) => void
}

// Derives tree selection handlers and selection synchronization from the current viewer state.
export const useIfcViewerTreeSelection = ({
  tree,
  selectedElement,
  selectedNodeIdSetter,
  lastWalkRoomNodeIdSetter,
  isWalkMode,
  resolveTreeNodeIdForSelection,
  resolveContainingRoomNodeIdForTree,
  clearIfcHighlight,
  selectCustomCube,
  selectById,
  hasRenderableExpressId,
  highlightIfcGroup,
  resetSelection,
  resolveNodeInsertTarget,
  moveCameraToPoint,
  teleportCameraToPoint
}: UseIfcViewerTreeSelectionArgs) => {
  // This maps a tree click to either a custom object selection or an IFC highlight/selection flow.
  const handleTreeSelect = useCallback(
    async (nodeId: string) => {
      selectedNodeIdSetter(nodeId)
      const node = tree.nodes[nodeId]
      if (!node) return

      if (
        node.nodeType === 'custom' &&
        node.modelID === CUSTOM_CUBE_MODEL_ID &&
        node.expressID !== null
      ) {
        clearIfcHighlight()
        selectCustomCube(node.expressID)
        return
      }

      if (node.nodeType === 'ifc' && node.expressID !== null) {
        await selectById(node.modelID, node.expressID, { autoFocus: false })
        const subtree = collectIfcIdsInSubtree(tree, nodeId)
        if (subtree.modelID === node.modelID) {
          const renderableIds = subtree.ids.filter((id) => hasRenderableExpressId(node.modelID, id))
          const isNodeRenderable = hasRenderableExpressId(node.modelID, node.expressID)
          if (renderableIds.length > 0 && (renderableIds.length > 1 || !isNodeRenderable)) {
            highlightIfcGroup(node.modelID, renderableIds, {
              anchorExpressID: node.expressID
            })
          }
        }
        return
      }

      clearIfcHighlight()
      resetSelection()
    },
    [
      clearIfcHighlight,
      hasRenderableExpressId,
      highlightIfcGroup,
      resetSelection,
      selectById,
      selectCustomCube,
      selectedNodeIdSetter,
      tree
    ]
  )

  // This focuses the selected room and updates the active room context used by the side panel.
  const handleRoomSelect = useCallback(
    async (nodeId: string) => {
      lastWalkRoomNodeIdSetter(nodeId)
      if (isWalkMode) {
        selectedNodeIdSetter(null)
      } else {
        selectedNodeIdSetter(nodeId)
      }
      const target = await resolveNodeInsertTarget(nodeId, { autoFocus: true })
      const roomFocusPoint = target
        ? { x: target.x, y: target.y + ROOM_SELECT_Y_OFFSET, z: target.z }
        : null
      if (!moveCameraToPoint(roomFocusPoint)) {
        teleportCameraToPoint(roomFocusPoint)
      }
      if (isWalkMode) {
        clearIfcHighlight()
        resetSelection()
        selectedNodeIdSetter(null)
      }
    },
    [
      clearIfcHighlight,
      isWalkMode,
      lastWalkRoomNodeIdSetter,
      moveCameraToPoint,
      resetSelection,
      resolveNodeInsertTarget,
      selectedNodeIdSetter,
      teleportCameraToPoint
    ]
  )

  // This keeps the selected tree node synchronized with the active IFC selection.
  useEffect(() => {
    if (!selectedElement) return

    const matchId = resolveTreeNodeIdForSelection(selectedElement.modelID, selectedElement.expressID)
    selectedNodeIdSetter(matchId)
    const roomNodeId = resolveContainingRoomNodeIdForTree(matchId)
    if (isWalkMode && roomNodeId) {
      lastWalkRoomNodeIdSetter((current) => (current === roomNodeId ? current : roomNodeId))
      return
    }
    if (roomNodeId && roomNodeId === matchId) {
      lastWalkRoomNodeIdSetter((current) => (current === roomNodeId ? current : roomNodeId))
    }
  }, [
    isWalkMode,
    lastWalkRoomNodeIdSetter,
    resolveContainingRoomNodeIdForTree,
    resolveTreeNodeIdForSelection,
    selectedElement,
    selectedNodeIdSetter
  ])

  return {
    handleTreeSelect,
    handleRoomSelect
  }
}
