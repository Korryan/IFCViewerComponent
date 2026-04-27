import type { ObjectTree, Point3D } from '../ifcViewerTypes'
import { buildUploadedFurnitureName } from '../ifcViewer.utils'
import { CUSTOM_CUBE_MODEL_ID } from './useSelectionOffsets'
import { resolveInsertParentId, resolveRoomNumberForTreeNode, resolveSpaceIfcIdForTreeNode } from './insertActions.targets'
import type { AddCustomNode, RegisterUploadedFurniture, SpawnUploadedModel } from './insertActions.types'

// This picks the insertion point from an explicit target, hover position or selected tree node fallback.
export const resolveRequestedInsertTarget = async (args: {
  requestedTarget?: Point3D | null
  insertTargetCoords: Point3D | null
  hoverCoords: Point3D | null
  requestedNodeId?: string | null
  selectedNodeId: string | null
  resolveNodeInsertTarget: (nodeId: string, options?: { autoFocus?: boolean }) => Promise<Point3D>
}): Promise<Point3D> => {
  const {
    requestedTarget,
    insertTargetCoords,
    hoverCoords,
    requestedNodeId,
    selectedNodeId,
    resolveNodeInsertTarget
  } = args
  return (
    requestedTarget ||
    insertTargetCoords ||
    hoverCoords ||
    (requestedNodeId ?? selectedNodeId
      ? await resolveNodeInsertTarget((requestedNodeId ?? selectedNodeId) as string)
      : { x: 0, y: 0, z: 0 })
  )
}

// This registers one uploaded object in furniture state, tree state and selection state in one place.
export const spawnUploadedTreeObject = async (args: {
  tree: ObjectTree
  roomNumbers: Map<number, string>
  uploadFile: File
  requestedNodeId?: string | null
  requestedTarget?: Point3D | null
  selectedNodeId: string | null
  insertTargetCoords: Point3D | null
  hoverCoords: Point3D | null
  resolveNodeInsertTarget: (nodeId: string, options?: { autoFocus?: boolean }) => Promise<Point3D>
  spawnUploadedModel: SpawnUploadedModel
  registerUploadedFurniture: RegisterUploadedFurniture
  addCustomNode: AddCustomNode
  setSelectedNodeId: (value: string | null) => void
  selectCustomCube: (expressID: number) => void
}): Promise<void> => {
  const {
    tree,
    roomNumbers,
    uploadFile,
    requestedNodeId,
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
  } = args

  const target = await resolveRequestedInsertTarget({
    requestedTarget,
    insertTargetCoords,
    hoverCoords,
    requestedNodeId,
    selectedNodeId,
    resolveNodeInsertTarget
  })

  const info = await spawnUploadedModel(uploadFile, target, { focus: true })
  if (!info) return

  const parentId = resolveInsertParentId(tree, requestedNodeId ?? selectedNodeId)
  const roomNumber = resolveRoomNumberForTreeNode(tree, roomNumbers, parentId)
  const spaceIfcId = resolveSpaceIfcIdForTreeNode(tree, parentId)
  await registerUploadedFurniture(uploadFile, info, roomNumber, spaceIfcId)

  const newNodeId = addCustomNode({
    modelID: CUSTOM_CUBE_MODEL_ID,
    expressID: info.expressID,
    label: buildUploadedFurnitureName(uploadFile.name),
    type: 'FURNITURE',
    parentId
  })
  setSelectedNodeId(newNodeId)
  selectCustomCube(info.expressID)
}
