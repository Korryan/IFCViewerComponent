import { useCallback, useRef } from 'react'
import type { ChangeEvent, Dispatch, MutableRefObject, SetStateAction } from 'react'
import type { FurnitureGeometry, ObjectTree, Point3D } from '../ifcViewerTypes'
import { buildUploadedFurnitureName } from '../ifcViewer.utils'
import { CUSTOM_CUBE_MODEL_ID } from './useSelectionOffsets'

type AddCustomNode = (payload: {
  modelID: number
  expressID?: number | null
  label: string
  type?: string
  parentId?: string | null
}) => string

type SpawnCube = (
  target?: Point3D | null,
  options?: { focus?: boolean; id?: number }
) => { expressID: number; position: Point3D } | null

type SpawnUploadedModelInfo = {
  modelID: number
  expressID: number
  position: Point3D
  geometry: FurnitureGeometry | null
} | null

type SpawnUploadedModel = (
  file: File,
  target?: Point3D | null,
  options?: { focus?: boolean }
) => Promise<SpawnUploadedModelInfo>

type RegisterCubeFurniture = (
  info: { expressID: number; position: Point3D },
  roomNumber?: string | null,
  spaceIfcId?: number | null
) => Promise<void>

type RegisterUploadedFurniture = (
  file: File,
  info: SpawnUploadedModelInfo,
  roomNumber?: string | null,
  spaceIfcId?: number | null
) => Promise<string | null>

type SelectById = (
  modelID: number,
  expressID: number,
  options?: { autoFocus?: boolean; allowedIfcTypes?: string[] }
) => Promise<Point3D | null>

type GetIfcElementPlacementPosition = (modelID: number, expressID: number) => Point3D | null
type EnsureIfcPlacementPosition = (modelID: number, expressID: number) => Promise<Point3D | null>

type UseInsertActionsArgs = {
  tree: ObjectTree
  roomNumbersRef: MutableRefObject<Map<number, string>>
  selectedNodeId: string | null
  setSelectedNodeId: Dispatch<SetStateAction<string | null>>
  hoverCoords: Point3D | null
  insertTargetCoords: Point3D | null
  addCustomNode: AddCustomNode
  registerCubeFurniture: RegisterCubeFurniture
  registerUploadedFurniture: RegisterUploadedFurniture
  selectById: SelectById
  getIfcElementPlacementPosition: GetIfcElementPlacementPosition
  ensureIfcPlacementPosition: EnsureIfcPlacementPosition
  selectCustomCube: (expressID: number) => void
  spawnCube: SpawnCube
  spawnUploadedModel: SpawnUploadedModel
}

type UseInsertActionsResult = {
  treeUploadInputRef: MutableRefObject<HTMLInputElement | null>
  resolveRoomNumberForNode: (nodeId: string | null | undefined) => string | null
  findSpaceNodeIdByRoomNumber: (roomNumber: string | null | undefined) => string | null
  resolveSpaceIfcIdForNode: (nodeId: string | null | undefined) => number | null
  resolveNodeInsertTarget: (
    nodeId: string,
    options?: { autoFocus?: boolean }
  ) => Promise<Point3D>
  spawnUnitCube: () => Promise<void>
  spawnUploadedModelAt: (uploadFile: File) => Promise<void>
  handleTreeAddCube: (nodeId: string) => Promise<void>
  handleTreeUploadModel: (nodeId: string) => void
  handleTreeUploadInputChange: (event: ChangeEvent<HTMLInputElement>) => Promise<void>
}

export const useInsertActions = ({
  tree,
  roomNumbersRef,
  selectedNodeId,
  setSelectedNodeId,
  hoverCoords,
  insertTargetCoords,
  addCustomNode,
  registerCubeFurniture,
  registerUploadedFurniture,
  selectById,
  getIfcElementPlacementPosition,
  ensureIfcPlacementPosition,
  selectCustomCube,
  spawnCube,
  spawnUploadedModel
}: UseInsertActionsArgs): UseInsertActionsResult => {
  const treeUploadInputRef = useRef<HTMLInputElement | null>(null)
  const pendingTreeUploadRef = useRef<string | null>(null)

  const resolveSpaceNodeForNode = useCallback(
    (nodeId: string | null | undefined): ObjectTree['nodes'][string] | null => {
      if (!nodeId) return null
      let currentId: string | null | undefined = nodeId
      while (currentId) {
        const node: ObjectTree['nodes'][string] | undefined = tree.nodes[currentId]
        if (!node) break
        if (
          node.nodeType === 'ifc' &&
          node.expressID !== null &&
          node.type.toUpperCase() === 'IFCSPACE'
        ) {
          return node
        }
        currentId = node.parentId
      }
      return null
    },
    [tree.nodes]
  )

  const resolveRoomNumberForNode = useCallback(
    (nodeId: string | null | undefined): string | null => {
      if (!nodeId) return null
      const roomNumbers = roomNumbersRef.current
      let currentId: string | null | undefined = nodeId
      while (currentId) {
        const node: ObjectTree['nodes'][string] | undefined = tree.nodes[currentId]
        if (!node) break
        if (node.nodeType === 'ifc' && node.expressID !== null) {
          const roomNumber = roomNumbers.get(node.expressID)
          if (roomNumber) return roomNumber
        }
        currentId = node.parentId
      }
      return null
    },
    [roomNumbersRef, tree.nodes]
  )

  const findSpaceNodeIdByRoomNumber = useCallback(
    (roomNumber: string | null | undefined): string | null => {
      if (!roomNumber) return null
      const roomNumbers = roomNumbersRef.current
      for (const node of Object.values(tree.nodes)) {
        if (node.nodeType !== 'ifc') continue
        if (node.expressID === null) continue
        if (node.type.toUpperCase() !== 'IFCSPACE') continue
        const spaceRoomNumber = roomNumbers.get(node.expressID)
        if (spaceRoomNumber === roomNumber) {
          return node.id
        }
      }
      return null
    },
    [roomNumbersRef, tree.nodes]
  )

  const resolveSpaceIfcIdForNode = useCallback(
    (nodeId: string | null | undefined): number | null => {
      if (!nodeId) return null
      let currentId: string | null | undefined = nodeId
      while (currentId) {
        const node: ObjectTree['nodes'][string] | undefined = tree.nodes[currentId]
        if (!node) break
        if (
          node.nodeType === 'ifc' &&
          node.expressID !== null &&
          node.type.toUpperCase() === 'IFCSPACE'
        ) {
          return node.expressID
        }
        currentId = node.parentId
      }
      return null
    },
    [tree.nodes]
  )

  const resolveNodeInsertTarget = useCallback(
    async (nodeId: string, options?: { autoFocus?: boolean }): Promise<Point3D> => {
      const node = tree.nodes[nodeId]
      const spaceNode =
        node && node.nodeType === 'ifc' && node.expressID !== null && node.type.toUpperCase() === 'IFCSPACE'
          ? node
          : resolveSpaceNodeForNode(nodeId)

      if (!node || node.nodeType !== 'ifc' || node.expressID === null) {
        if (spaceNode) {
          return (
            getIfcElementPlacementPosition(spaceNode.modelID, spaceNode.expressID!) ??
            (await ensureIfcPlacementPosition(spaceNode.modelID, spaceNode.expressID!)) ??
            { x: 0, y: 0, z: 0 }
          )
        }
        return { x: 0, y: 0, z: 0 }
      }

      const target = await selectById(node.modelID, node.expressID, {
        autoFocus: options?.autoFocus
      })
      if (target) {
        return target
      }

      if (spaceNode) {
        return (
          getIfcElementPlacementPosition(spaceNode.modelID, spaceNode.expressID!) ??
          (await ensureIfcPlacementPosition(spaceNode.modelID, spaceNode.expressID!)) ??
          { x: 0, y: 0, z: 0 }
        )
      }

      return { x: 0, y: 0, z: 0 }
    },
    [ensureIfcPlacementPosition, getIfcElementPlacementPosition, resolveSpaceNodeForNode, selectById, tree.nodes]
  )

  const spawnUnitCube = useCallback(async () => {
    const target =
      insertTargetCoords ||
      hoverCoords ||
      (selectedNodeId ? await resolveNodeInsertTarget(selectedNodeId) : null)
    const info = spawnCube(target, { focus: true })
    if (!info) return
    const roomNumber = resolveRoomNumberForNode(selectedNodeId)
    const spaceIfcId = resolveSpaceIfcIdForNode(selectedNodeId)
    await registerCubeFurniture(info, roomNumber, spaceIfcId)
    addCustomNode({
      modelID: CUSTOM_CUBE_MODEL_ID,
      expressID: info.expressID,
      label: `Cube #${info.expressID}`,
      type: 'CUBE',
      parentId: selectedNodeId
    })
  }, [
    addCustomNode,
    hoverCoords,
    insertTargetCoords,
    registerCubeFurniture,
    resolveRoomNumberForNode,
    resolveSpaceIfcIdForNode,
    selectedNodeId,
    spawnCube
  ])

  const spawnUploadedModelAt = useCallback(
    async (uploadFile: File) => {
      const target =
        insertTargetCoords ||
        hoverCoords ||
        (selectedNodeId ? await resolveNodeInsertTarget(selectedNodeId) : { x: 0, y: 0, z: 0 })
      const info = await spawnUploadedModel(uploadFile, target, { focus: true })
      if (!info) return
      const roomNumber = resolveRoomNumberForNode(selectedNodeId)
      const spaceIfcId = resolveSpaceIfcIdForNode(selectedNodeId)
      const parentId = findSpaceNodeIdByRoomNumber(roomNumber) ?? selectedNodeId
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
    },
    [
      addCustomNode,
      findSpaceNodeIdByRoomNumber,
      hoverCoords,
      insertTargetCoords,
      registerUploadedFurniture,
      resolveRoomNumberForNode,
      resolveSpaceIfcIdForNode,
      selectedNodeId,
      setSelectedNodeId,
      selectCustomCube,
      spawnUploadedModel
    ]
  )

  const handleTreeAddCube = useCallback(
    async (nodeId: string) => {
      const resolvedTarget = await resolveNodeInsertTarget(nodeId)
      const info = spawnCube(resolvedTarget, { focus: true })
      if (!info) return
      const roomNumber = resolveRoomNumberForNode(nodeId)
      const spaceIfcId = resolveSpaceIfcIdForNode(nodeId)
      await registerCubeFurniture(info, roomNumber, spaceIfcId)
      const newNodeId = addCustomNode({
        modelID: CUSTOM_CUBE_MODEL_ID,
        expressID: info.expressID,
        label: `Cube #${info.expressID}`,
        type: 'CUBE',
        parentId: nodeId
      })
      setSelectedNodeId(newNodeId)
      selectCustomCube(info.expressID)
    },
    [
      addCustomNode,
      registerCubeFurniture,
      resolveNodeInsertTarget,
      resolveRoomNumberForNode,
      resolveSpaceIfcIdForNode,
      selectCustomCube,
      setSelectedNodeId,
      spawnCube
    ]
  )

  const handleTreeUploadModel = useCallback((nodeId: string) => {
    pendingTreeUploadRef.current = nodeId
    treeUploadInputRef.current?.click()
  }, [])

  const handleTreeUploadInputChange = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const inputFile = event.target.files?.[0]
      const parentId = pendingTreeUploadRef.current
      if (inputFile && parentId) {
        const resolvedTarget = await resolveNodeInsertTarget(parentId)
        const roomNumber = resolveRoomNumberForNode(parentId)
        const spaceIfcId = resolveSpaceIfcIdForNode(parentId)
        const info = await spawnUploadedModel(inputFile, resolvedTarget, { focus: true })
        if (info) {
          await registerUploadedFurniture(inputFile, info, roomNumber, spaceIfcId)
          const newNodeId = addCustomNode({
            modelID: CUSTOM_CUBE_MODEL_ID,
            expressID: info.expressID,
            label: buildUploadedFurnitureName(inputFile.name),
            type: 'FURNITURE',
            parentId
          })
          setSelectedNodeId(newNodeId)
          selectCustomCube(info.expressID)
        }
      }
      pendingTreeUploadRef.current = null
      event.target.value = ''
    },
    [
      addCustomNode,
      registerUploadedFurniture,
      resolveNodeInsertTarget,
      resolveRoomNumberForNode,
      resolveSpaceIfcIdForNode,
      setSelectedNodeId,
      selectCustomCube,
      spawnUploadedModel
    ]
  )

  return {
    treeUploadInputRef,
    resolveRoomNumberForNode,
    findSpaceNodeIdByRoomNumber,
    resolveSpaceIfcIdForNode,
    resolveNodeInsertTarget,
    spawnUnitCube,
    spawnUploadedModelAt,
    handleTreeAddCube,
    handleTreeUploadModel,
    handleTreeUploadInputChange
  }
}
