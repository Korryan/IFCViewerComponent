export type SelectedElement = {
  modelID: number
  expressID: number
  type?: string
}

export type PropertyField = {
  key: string
  label: string
  value: string
}

export type HistoryEntry = {
  ifcId: number
  label: string
  timestamp: string
}

export type OffsetVector = {
  dx: number
  dy: number
  dz: number
}

export type Point3D = {
  x: number
  y: number
  z: number
}

export type MetadataEntry = {
  ifcId: number
  type?: string
  custom?: Record<string, string>
  position?: Point3D
  moveDelta?: Point3D
  rotation?: Point3D
  rotateDelta?: Point3D
  deleted?: boolean
  updatedAt?: string
}

export type FurnitureItem = {
  id: string
  model: string
  name?: string
  position: Point3D
  rotation?: Point3D
  scale?: Point3D
  roomNumber?: string
  spaceIfcId?: number
  custom?: Record<string, string>
  geometry?: FurnitureGeometry
  updatedAt?: string
}

export type FurnitureGeometry = {
  positions: number[]
  indices: number[]
}

export type ObjectTreeNode = {
  id: string
  modelID: number
  expressID: number | null
  label: string
  name?: string | null
  type: string
  nodeType: 'ifc' | 'custom'
  parentId: string | null
  children: string[]
}

export type ObjectTree = {
  nodes: Record<string, ObjectTreeNode>
  roots: string[]
}
