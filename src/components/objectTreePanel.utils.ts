import type { ObjectTree, ObjectTreeNode } from '../ifcViewerTypes'
import type { MenuAnchor, RoomEntry, RoomGroup } from './objectTreePanel.types'

// Normalizes one IFC type name into the canonical uppercase form used by tree rules.
const normalizeIfcType = (value: string) => value.trim().toUpperCase()

// Returns the display form of one IFC express id when the node actually represents an IFC object.
export const getNodeIfcDisplayId = (node: ObjectTreeNode) => {
  return node.nodeType === 'ifc' && node.expressID !== null ? `#${String(node.expressID)}` : null
}

// Returns whether one node should render the localized type badge before its label.
export const shouldShowNodeTypeBadge = (node: ObjectTreeNode, localizedType: string) => {
  return node.label.trim().toLocaleLowerCase() !== localizedType.trim().toLocaleLowerCase()
}

// Returns whether one tree node should expose the insert-child action button.
export const canNodeAcceptChildren = (node: ObjectTreeNode) => {
  return node.nodeType === 'ifc' && normalizeIfcType(node.type) === 'IFCSPACE'
}

// Builds the selected-node ancestor set and breadcrumb trail used by the panel header and tree highlighting.
export const buildSelectionState = (tree: ObjectTree, selectedNodeId: string | null) => {
  const ids: string[] = []
  const trail: string[] = []
  if (!selectedNodeId) {
    return { selectionPath: new Set<string>(), selectionTrail: trail }
  }

  let current: string | null = selectedNodeId
  while (current) {
    ids.push(current)
    const node: ObjectTreeNode | undefined = tree.nodes[current]
    if (!node?.parentId) break
    current = node.parentId
  }

  ids
    .slice()
    .reverse()
    .forEach((id) => {
      const node: ObjectTreeNode | undefined = tree.nodes[id]
      if (node) {
        trail.push(node.label)
      }
    })

  return {
    selectionPath: new Set(ids),
    selectionTrail: trail
  }
}

// Groups rooms by their storey label while preserving the incoming room order within each group.
export const groupRoomsByStorey = (rooms: RoomEntry[]): RoomGroup[] => {
  const groups: RoomGroup[] = []
  rooms.forEach((room) => {
    const groupLabel = room.storeyLabel?.trim() || 'Nezarazene'
    const lastGroup = groups[groups.length - 1]
    if (!lastGroup || lastGroup.label !== groupLabel) {
      groups.push({ label: groupLabel, rooms: [room] })
      return
    }
    lastGroup.rooms.push(room)
  })
  return groups
}

// Counts every descendant node under the requested tree node id.
export const countDescendantNodes = (tree: ObjectTree, nodeId: string | null | undefined) => {
  if (!nodeId) return 0
  const rootNode = tree.nodes[nodeId]
  if (!rootNode) return 0

  let count = 0
  const stack = [...rootNode.children]
  while (stack.length > 0) {
    const currentId = stack.pop()
    if (!currentId) continue
    const current = tree.nodes[currentId]
    if (!current) continue
    count += 1
    if (current.children.length > 0) {
      stack.push(...current.children)
    }
  }

  return count
}

// Resolves the menu anchor position from one row trigger button and its nearest row container.
export const resolveMenuAnchorFromButton = (
  button: HTMLButtonElement,
  rowSelector: string
): MenuAnchor => {
  const row = button.closest(rowSelector) as HTMLDivElement | null
  const rect = row?.getBoundingClientRect() ?? button.getBoundingClientRect()
  const anchorX = row ? rect.left + rect.width / 2 : rect.left
  return { x: anchorX, y: rect.bottom }
}

// Converts one viewport-relative anchor into panel-local coordinates for the insert menu.
export const resolvePanelMenuAnchor = (
  panel: HTMLElement | null,
  anchor: MenuAnchor
): MenuAnchor | null => {
  if (!panel) return null
  const panelRect = panel.getBoundingClientRect()
  return {
    x: Math.max(0, anchor.x - panelRect.left),
    y: Math.max(0, anchor.y - panelRect.top)
  }
}
