import { useCallback, useRef } from 'react'
import type { ChangeEvent } from 'react'
import type { Point3D } from '../ifcViewerTypes'
import {
  findSpaceNodeIdByIfcIdInTree,
  isTreeNodeInsideSpace,
  findSpaceNodeIdByRoomNumberInTree,
  resolveInsertTargetForNode,
  resolveRoomNumberForTreeNode,
  resolveSpaceIfcIdForTreeNode
} from './insertActions.targets'
import { spawnUploadedTreeObject } from './insertActions.spawn'
import type { UseInsertActionsArgs, UseInsertActionsResult } from './insertActions.types'

export const useInsertActions = ({
  tree,
  roomNumbersRef,
  selectedNodeId,
  activeRoomNodeId = null,
  setSelectedNodeId,
  roomOnlyTransformGuard,
  setStatus,
  hoverCoords,
  insertTargetCoords,
  addCustomNode,
  registerUploadedFurniture,
  selectById,
  getElementWorldPosition,
  getIfcElementPlacementPosition,
  ensureIfcPlacementPosition,
  selectCustomCube,
  spawnUploadedModel
}: UseInsertActionsArgs): UseInsertActionsResult => {
  const treeUploadInputRef = useRef<HTMLInputElement | null>(null)
  const pendingTreeUploadRef = useRef<string | null>(null)

  // This prevents inserting objects outside rooms while room-only edit mode is active.
  const canInsertAtNode = useCallback(
    (nodeId: string | null | undefined): boolean => {
      if (!roomOnlyTransformGuard) return true
      if (isTreeNodeInsideSpace(tree, nodeId)) return true
      setStatus('Room-only edit is on. Select a room or an object inside a room before adding an object.')
      return false
    },
    [roomOnlyTransformGuard, setStatus, tree]
  )

  // This resolves the first room number found while walking from one tree node upward.
  const resolveRoomNumberForNode = useCallback(
    (nodeId: string | null | undefined): string | null =>
      resolveRoomNumberForTreeNode(tree, roomNumbersRef.current, nodeId),
    [roomNumbersRef, tree]
  )

  // This finds a room node id from a room number inside the current tree snapshot.
  const findSpaceNodeIdByRoomNumber = useCallback(
    (roomNumber: string | null | undefined): string | null =>
      findSpaceNodeIdByRoomNumberInTree(tree, roomNumbersRef.current, roomNumber),
    [roomNumbersRef, tree]
  )

  // This finds a room node id from an IFC express id inside the current tree snapshot.
  const findSpaceNodeIdByIfcId = useCallback(
    (spaceIfcId: number | null | undefined): string | null => findSpaceNodeIdByIfcIdInTree(tree, spaceIfcId),
    [tree]
  )

  // This resolves the containing room express id above one tree node.
  const resolveSpaceIfcIdForNode = useCallback(
    (nodeId: string | null | undefined): number | null => resolveSpaceIfcIdForTreeNode(tree, nodeId),
    [tree]
  )

  // This resolves the world target point used when inserting into the scene from one tree node.
  const resolveNodeInsertTarget = useCallback(
    async (nodeId: string, options?: { autoFocus?: boolean }) =>
      resolveInsertTargetForNode({
        tree,
        nodeId,
        options,
        selectById,
        getElementWorldPosition,
        getIfcElementPlacementPosition,
        ensureIfcPlacementPosition
      }),
    [
      ensureIfcPlacementPosition,
      getElementWorldPosition,
      getIfcElementPlacementPosition,
      selectById,
      tree
    ]
  )

  // This uploads and inserts one IFC object into the scene, furniture state and tree state together.
  const spawnUploadedModelAt = useCallback(
    async (uploadFile: File, requestedNodeId?: string | null, requestedTarget?: Point3D | null) => {
      const targetNodeId = requestedNodeId ?? selectedNodeId ?? activeRoomNodeId
      if (!canInsertAtNode(targetNodeId)) return

      await spawnUploadedTreeObject({
        tree,
        roomNumbers: roomNumbersRef.current,
        uploadFile,
        requestedNodeId: targetNodeId,
        requestedTarget,
        selectedNodeId,
        insertTargetCoords,
        hoverCoords,
        resolveNodeInsertTarget,
        spawnUploadedModel,
        registerUploadedFurniture,
        addCustomNode,
        setSelectedNodeId,
        selectCustomCube
      })
    },
    [
      addCustomNode,
      activeRoomNodeId,
      canInsertAtNode,
      hoverCoords,
      insertTargetCoords,
      registerUploadedFurniture,
      resolveNodeInsertTarget,
      roomNumbersRef,
      selectedNodeId,
      setSelectedNodeId,
      selectCustomCube,
      spawnUploadedModel,
      tree
    ]
  )

  // This inserts a prefab IFC file using the same flow as any other uploaded custom object.
  const spawnPrefabAt = useCallback(
    async (prefabFile: File) => {
      const resolvedTarget = activeRoomNodeId ? await resolveNodeInsertTarget(activeRoomNodeId) : null
      await spawnUploadedModelAt(prefabFile, activeRoomNodeId, resolvedTarget)
    },
    [activeRoomNodeId, resolveNodeInsertTarget, spawnUploadedModelAt]
  )

  // This remembers the tree node that requested a file upload before opening the hidden file input.
  const handleTreeUploadModel = useCallback((nodeId: string) => {
    if (!canInsertAtNode(nodeId)) return
    pendingTreeUploadRef.current = nodeId
    treeUploadInputRef.current?.click()
  }, [canInsertAtNode])

  // This inserts one prefab under the requested tree node using the resolved room target position.
  const handleTreeInsertPrefab = useCallback(
    async (nodeId: string, prefabFile: File) => {
      if (!canInsertAtNode(nodeId)) return
      const resolvedTarget = await resolveNodeInsertTarget(nodeId)
      await spawnUploadedModelAt(prefabFile, nodeId, resolvedTarget)
    },
    [canInsertAtNode, resolveNodeInsertTarget, spawnUploadedModelAt]
  )

  // This completes the hidden file-input flow started from the object tree and then clears the pending request.
  const handleTreeUploadInputChange = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const inputFile = event.target.files?.[0]
      const requestedParentId = pendingTreeUploadRef.current
      if (inputFile && requestedParentId) {
        if (!canInsertAtNode(requestedParentId)) {
          pendingTreeUploadRef.current = null
          event.target.value = ''
          return
        }
        const resolvedTarget = await resolveNodeInsertTarget(requestedParentId)
        await spawnUploadedModelAt(inputFile, requestedParentId, resolvedTarget)
      }
      pendingTreeUploadRef.current = null
      event.target.value = ''
    },
    [
      canInsertAtNode,
      resolveNodeInsertTarget,
      spawnUploadedModelAt
    ]
  )

  return {
    treeUploadInputRef,
    resolveRoomNumberForNode,
    findSpaceNodeIdByRoomNumber,
    findSpaceNodeIdByIfcId,
    resolveSpaceIfcIdForNode,
    resolveNodeInsertTarget,
    spawnUploadedModelAt,
    spawnPrefabAt,
    handleTreeInsertPrefab,
    handleTreeUploadModel,
    handleTreeUploadInputChange
  }
}
