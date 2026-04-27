import type { ChangeEvent, Dispatch, MutableRefObject, SetStateAction } from 'react'
import type { FurnitureGeometry, ObjectTree, Point3D } from '../ifcViewerTypes'

export type AddCustomNode = (payload: {
  modelID: number
  expressID?: number | null
  label: string
  type?: string
  parentId?: string | null
}) => string

export type SpawnUploadedModelInfo = {
  modelID: number
  expressID: number
  position: Point3D
  geometry: FurnitureGeometry | null
} | null

export type SpawnUploadedModel = (
  file: File,
  target?: Point3D | null,
  options?: { focus?: boolean }
) => Promise<SpawnUploadedModelInfo>

export type RegisterUploadedFurniture = (
  file: File,
  info: SpawnUploadedModelInfo,
  roomNumber?: string | null,
  spaceIfcId?: number | null
) => Promise<string | null>

export type SelectById = (
  modelID: number,
  expressID: number,
  options?: { autoFocus?: boolean; allowedIfcTypes?: string[] }
) => Promise<Point3D | null>

export type GetElementWorldPosition = (modelID: number, expressID: number) => Point3D | null
export type GetIfcElementPlacementPosition = (modelID: number, expressID: number) => Point3D | null
export type EnsureIfcPlacementPosition = (modelID: number, expressID: number) => Promise<Point3D | null>

export type UseInsertActionsArgs = {
  tree: ObjectTree
  roomNumbersRef: MutableRefObject<Map<number, string>>
  selectedNodeId: string | null
  setSelectedNodeId: Dispatch<SetStateAction<string | null>>
  hoverCoords: Point3D | null
  insertTargetCoords: Point3D | null
  addCustomNode: AddCustomNode
  registerUploadedFurniture: RegisterUploadedFurniture
  selectById: SelectById
  getElementWorldPosition: GetElementWorldPosition
  getIfcElementPlacementPosition: GetIfcElementPlacementPosition
  ensureIfcPlacementPosition: EnsureIfcPlacementPosition
  selectCustomCube: (expressID: number) => void
  spawnUploadedModel: SpawnUploadedModel
}

export type UseInsertActionsResult = {
  treeUploadInputRef: MutableRefObject<HTMLInputElement | null>
  resolveRoomNumberForNode: (nodeId: string | null | undefined) => string | null
  findSpaceNodeIdByRoomNumber: (roomNumber: string | null | undefined) => string | null
  findSpaceNodeIdByIfcId: (spaceIfcId: number | null | undefined) => string | null
  resolveSpaceIfcIdForNode: (nodeId: string | null | undefined) => number | null
  resolveNodeInsertTarget: (
    nodeId: string,
    options?: { autoFocus?: boolean }
  ) => Promise<Point3D>
  spawnUploadedModelAt: (uploadFile: File) => Promise<void>
  spawnPrefabAt: (prefabFile: File) => Promise<void>
  handleTreeInsertPrefab: (nodeId: string, prefabFile: File) => Promise<void>
  handleTreeUploadModel: (nodeId: string) => void
  handleTreeUploadInputChange: (event: ChangeEvent<HTMLInputElement>) => Promise<void>
}
