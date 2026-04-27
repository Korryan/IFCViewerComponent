import type { InsertPrefabOption, ObjectTree } from '../ifcViewerTypes'

// Describes one room entry rendered in the room list and room contents views.
export type RoomEntry = {
  nodeId: string
  label: string
  ifcId: number
  roomNumber?: string | null
  storeyLabel?: string | null
}

// Describes one menu anchor position within the object tree panel.
export type MenuAnchor = {
  x: number
  y: number
}

// Describes one grouped room section rendered under a shared storey label.
export type RoomGroup = {
  label: string
  rooms: RoomEntry[]
}

// Describes the supported content modes inside the object tree panel.
export type ObjectTreePanelViewMode = 'tree' | 'rooms' | 'roomContents'

// Describes the public props accepted by the object tree panel.
export type ObjectTreePanelProps = {
  tree: ObjectTree
  selectedNodeId: string | null
  onSelectNode: (nodeId: string) => void
  rooms?: RoomEntry[]
  roomContents?: RoomEntry | null
  activeRoomNodeId?: string | null
  onSelectRoom?: (nodeId: string) => void
  prefabs?: InsertPrefabOption[]
  onInsertPrefab: (nodeId: string, prefabId: string) => void
  onUploadModel: (nodeId: string) => void
}

// Describes the props shared by recursive tree-node renderers.
export type ObjectTreePanelTreeNodeProps = {
  nodeId: string
  depth: number
  expanded: Set<string>
  pathSet: Set<string>
  toggle: (id: string) => void
  onOpenMenu: (nodeId: string, anchor: MenuAnchor) => void
  selectedNodeId: string | null
  onSelectNode: (nodeId: string) => void
  nodes: ObjectTree['nodes']
}

// Describes the props shared by room row renderers in room-based views.
export type ObjectTreePanelRoomRowProps = {
  room: RoomEntry
  selected: boolean
  onSelect: (nodeId: string) => void
  onOpenMenu: (nodeId: string, anchor: MenuAnchor) => void
}
