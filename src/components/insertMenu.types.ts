import type { InsertPrefabOption } from '../ifcViewerTypes'

// Describes the public props accepted by the insert menu overlay.
export type InsertMenuProps = {
  open: boolean
  anchor: { x: number; y: number } | null
  prefabs?: InsertPrefabOption[]
  onInsertPrefab: (prefabId: string) => void
  onUploadClick: () => void
  onCancel: () => void
  alignX?: 'left' | 'center'
}

// Describes the props accepted by the prefab list section inside the insert menu.
export type InsertMenuListProps = {
  prefabs: InsertPrefabOption[]
  onInsertPrefab: (prefabId: string) => void
  onUploadClick: () => void
}
