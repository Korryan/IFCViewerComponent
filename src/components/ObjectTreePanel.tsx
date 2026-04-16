import { useEffect, useMemo, useRef, useState } from 'react'
import type { ObjectTree } from '../ifcViewerTypes'
import type { InsertPrefabOption } from '../ifcViewerTypes'
import { InsertMenu } from './InsertMenu'
import { localizeIfcType } from '../utils/ifcTypeLocalization'

type ObjectTreePanelProps = {
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

type RoomEntry = {
  nodeId: string
  label: string
  ifcId: number
  roomNumber?: string | null
  storeyLabel?: string | null
}

type RenderNodeArgs = {
  nodeId: string
  depth: number
  expanded: Set<string>
  pathSet: Set<string>
  toggle: (id: string) => void
  onOpenMenu: (nodeId: string, anchor: { x: number; y: number }) => void
  selectedNodeId: string | null
  onSelectNode: (nodeId: string) => void
  nodes: ObjectTree['nodes']
}

const indentSize = 12
const normalizeIfcType = (value: string) => value.trim().toUpperCase()

const TreeNode = ({
  nodeId,
  depth,
  expanded,
  pathSet,
  toggle,
  onOpenMenu,
  selectedNodeId,
  onSelectNode,
  nodes
}: RenderNodeArgs) => {
  const node = nodes[nodeId]
  if (!node) return null
  const hasChildren = node.children.length > 0
  const isExpanded = expanded.has(nodeId)
  const isSelected = selectedNodeId === nodeId
  const isOnPath = pathSet.has(nodeId)
  const localizedType = localizeIfcType(node.type)
  const ifcDisplayId =
    node.nodeType === 'ifc' && node.expressID !== null ? `#${String(node.expressID)}` : null
  const showTypeBadge = node.label.trim().toLocaleLowerCase() !== localizedType.trim().toLocaleLowerCase()
  const canAddChild = node.nodeType === 'ifc' && normalizeIfcType(node.type) === 'IFCSPACE'

  return (
    <div className="tree-node" style={{ paddingLeft: depth * indentSize }}>
      <div className="tree-node__row">
        <button
          type="button"
          className="tree-node__toggle"
          onClick={() => (hasChildren ? toggle(nodeId) : onSelectNode(nodeId))}
          aria-label={hasChildren ? (isExpanded ? 'Collapse' : 'Expand') : 'Select'}
        >
          {hasChildren ? (isExpanded ? 'v' : '>') : '-'}
        </button>
        <button
          type="button"
          className={[
            'tree-node__label',
            isOnPath ? 'tree-node__label--path' : '',
            isSelected ? 'tree-node__label--selected' : ''
          ]
            .filter(Boolean)
            .join(' ')}
          onClick={() => onSelectNode(nodeId)}
          title={ifcDisplayId ? `${node.label} ${ifcDisplayId}` : node.label}
          data-node-id={nodeId}
          data-ifc-id={ifcDisplayId ?? undefined}
        >
          {showTypeBadge && <span className="tree-node__type">{localizedType}</span>}
          <span className="tree-node__name">{node.label}</span>
          {ifcDisplayId && <span className="tree-node__id">{ifcDisplayId}</span>}
        </button>
        {canAddChild && (
          <button
            type="button"
            className="tree-node__add"
            onClick={(event) => {
              event.stopPropagation()
              const button = event.currentTarget as HTMLButtonElement
              const row = button.closest('.tree-node__row') as HTMLDivElement | null
              const rect = row?.getBoundingClientRect() ?? button.getBoundingClientRect()
              const anchorX = row ? rect.left + rect.width / 2 : rect.left
              onOpenMenu(nodeId, { x: anchorX, y: rect.bottom })
            }}
            aria-label="Add child object"
            title="Add child object"
          >
            +
          </button>
        )}
      </div>
      {hasChildren && isExpanded && (
        <div className="tree-node__children">
          {node.children.map((childId) => (
            <TreeNode
              key={childId}
              nodeId={childId}
              depth={depth + 1}
              expanded={expanded}
              pathSet={pathSet}
              toggle={toggle}
              onOpenMenu={onOpenMenu}
              selectedNodeId={selectedNodeId}
              onSelectNode={onSelectNode}
              nodes={nodes}
            />
          ))}
        </div>
      )}
    </div>
  )
}

export const ObjectTreePanel = ({
  tree,
  selectedNodeId,
  onSelectNode,
  rooms = [],
  roomContents = null,
  activeRoomNodeId = null,
  onSelectRoom,
  prefabs = [],
  onInsertPrefab,
  onUploadModel
}: ObjectTreePanelProps) => {
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [menuAnchor, setMenuAnchor] = useState<{ x: number; y: number } | null>(null)
  const [menuNodeId, setMenuNodeId] = useState<string | null>(null)
  const [viewMode, setViewMode] = useState<'tree' | 'rooms' | 'roomContents'>('tree')
  const contentRef = useRef<HTMLDivElement | null>(null)
  const panelRef = useRef<HTMLElement | null>(null)

  // Auto-expand roots when tree changes
  useEffect(() => {
    const next = new Set<string>()
    tree.roots.forEach((rootId) => next.add(rootId))
    setExpanded(next)
    setMenuAnchor(null)
    setMenuNodeId(null)
  }, [tree.roots])

  useEffect(() => {
    if (viewMode === 'rooms' && rooms.length === 0) {
      setViewMode('tree')
    }
    if (viewMode === 'roomContents' && (!roomContents || !tree.nodes[roomContents.nodeId])) {
      setViewMode(rooms.length > 0 ? 'rooms' : 'tree')
    }
  }, [roomContents, rooms.length, tree.nodes, viewMode])

  const { selectionPath, selectionTrail } = useMemo(() => {
    const ids: string[] = []
    const trail: string[] = []
    if (!selectedNodeId) {
      return { selectionPath: new Set<string>(), selectionTrail: trail }
    }
    let current: string | null = selectedNodeId
    while (current) {
      ids.push(current)
      const node: ObjectTree['nodes'][string] | undefined = tree.nodes[current]
      if (!node || !node.parentId) break
      current = node.parentId
    }
    ids
      .slice()
      .reverse()
      .forEach((id) => {
        const node: ObjectTree['nodes'][string] | undefined = tree.nodes[id]
        if (node) {
          trail.push(node.label)
        }
      })
    return { selectionPath: new Set(ids), selectionTrail: trail }
  }, [selectedNodeId, tree.nodes])

  useEffect(() => {
    if (!selectedNodeId) return
    setExpanded((prev) => {
      const next = new Set(prev)
      selectionPath.forEach((id) => next.add(id))
      return next
    })
  }, [selectedNodeId, selectionPath])

  useEffect(() => {
    if (!selectedNodeId) return
    const container = contentRef.current
    if (!container) return
    const target = container.querySelector(
      `[data-node-id="${selectedNodeId}"], [data-room-node-id="${selectedNodeId}"]`
    )
    if (target && 'scrollIntoView' in target) {
      ;(target as HTMLElement).scrollIntoView({ block: 'center' })
    }
  }, [expanded, selectedNodeId])

  const toggle = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  const hasContent = useMemo(() => tree.roots.length > 0, [tree.roots])
  const hasRooms = useMemo(() => rooms.length > 0, [rooms])
  const hasRoomContents = useMemo(
    () => Boolean(roomContents && tree.nodes[roomContents.nodeId]),
    [roomContents, tree.nodes]
  )
  const roomContentsNode = hasRoomContents && roomContents ? tree.nodes[roomContents.nodeId] : null
  const isRoomMode = viewMode === 'rooms'
  const isRoomContentsMode = viewMode === 'roomContents'
  const roomGroups = useMemo(() => {
    const groups: Array<{ label: string; rooms: typeof rooms }> = []
    rooms.forEach((room) => {
      const groupLabel = room.storeyLabel?.trim() || 'Nezařazené'
      const lastGroup = groups[groups.length - 1]
      if (!lastGroup || lastGroup.label !== groupLabel) {
        groups.push({ label: groupLabel, rooms: [room] })
        return
      }
      lastGroup.rooms.push(room)
    })
    return groups
  }, [rooms])
  const roomContentsCount = useMemo(() => {
    if (!roomContentsNode) return 0
    let count = 0
    const stack = [...roomContentsNode.children]
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
  }, [roomContentsNode, tree.nodes])

  const handleOpenMenu = (nodeId: string, anchor: { x: number; y: number }) => {
    const panel = panelRef.current
    if (!panel) {
      setMenuAnchor(null)
      setMenuNodeId(null)
      return
    }
    const panelRect = panel.getBoundingClientRect()
    setMenuAnchor({
      x: Math.max(0, anchor.x - panelRect.left),
      y: Math.max(0, anchor.y - panelRect.top)
    })
    setMenuNodeId(nodeId)
  }

  const handleCloseMenu = () => {
    setMenuAnchor(null)
    setMenuNodeId(null)
  }

  return (
    <section className="tree-panel" ref={panelRef}>
      <header className="tree-panel__header">
        <h2>Object tree</h2>
        <p>Hierarchy from IFC spatial structure.</p>
        <p className="tree-panel__path">
          {selectionTrail.length > 0 ? selectionTrail.join(' / ') : 'No selection'}
        </p>
      </header>
      <div className="tree-panel__actions">
        <div className="tree-panel__mode-switch" role="tablist" aria-label="Panel view">
          <button
            type="button"
            className={[
              'tree-panel__mode-toggle',
              !isRoomMode && !isRoomContentsMode ? 'tree-panel__mode-toggle--active' : ''
            ]
              .filter(Boolean)
              .join(' ')}
            onClick={() => setViewMode('tree')}
            aria-pressed={!isRoomMode && !isRoomContentsMode}
          >
            Tree
          </button>
          <button
            type="button"
            className={[
              'tree-panel__mode-toggle',
              isRoomMode ? 'tree-panel__mode-toggle--active' : ''
            ]
              .filter(Boolean)
              .join(' ')}
            onClick={() => setViewMode('rooms')}
            disabled={!hasRooms}
            aria-pressed={isRoomMode}
          >
            Rooms{hasRooms ? ` (${rooms.length})` : ''}
          </button>
          <button
            type="button"
            className={[
              'tree-panel__mode-toggle',
              isRoomContentsMode ? 'tree-panel__mode-toggle--active' : ''
            ]
              .filter(Boolean)
              .join(' ')}
            onClick={() => setViewMode('roomContents')}
            disabled={!hasRoomContents}
            aria-pressed={isRoomContentsMode}
          >
            Room items{roomContentsCount > 0 ? ` (${roomContentsCount})` : ''}
          </button>
        </div>
      </div>
      <div ref={contentRef} className="tree-panel__content">
        {isRoomMode ? (
          hasRooms ? (
            <div className="tree-panel__rooms">
              {roomGroups.map((group) => (
                <div key={group.label} className="tree-panel__room-group">
                  <p className="tree-panel__room-group-title">{group.label}</p>
                  {group.rooms.map((room) => (
                    <div key={room.nodeId} className="tree-panel__room-row">
                      <button
                        type="button"
                        className={[
                          'tree-panel__room',
                          selectedNodeId === room.nodeId || activeRoomNodeId === room.nodeId
                            ? 'tree-panel__room--selected'
                            : ''
                        ]
                          .filter(Boolean)
                          .join(' ')}
                        onClick={() => {
                          ;(onSelectRoom ?? onSelectNode)(room.nodeId)
                        }}
                        data-room-node-id={room.nodeId}
                        title={room.label}
                      >
                        <span className="tree-panel__room-label-group">
                          <span className="tree-panel__room-label">{room.label}</span>
                          <span className="tree-panel__room-number">#{room.ifcId}</span>
                        </span>
                        {room.roomNumber && (
                          <span className="tree-panel__room-meta">c. {room.roomNumber}</span>
                        )}
                      </button>
                      <button
                        type="button"
                        className="tree-node__add"
                        onClick={(event) => {
                          event.stopPropagation()
                          const button = event.currentTarget as HTMLButtonElement
                          const row = button.closest('.tree-panel__room-row') as HTMLDivElement | null
                          const rect = row?.getBoundingClientRect() ?? button.getBoundingClientRect()
                          const anchorX = row ? rect.left + rect.width / 2 : rect.left
                          handleOpenMenu(room.nodeId, { x: anchorX, y: rect.bottom })
                        }}
                        aria-label="Add child object"
                        title="Add child object"
                      >
                        +
                      </button>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          ) : (
            <p className="tree-panel__status">No rooms found in this model.</p>
          )
        ) : isRoomContentsMode ? (
          roomContents && roomContentsNode ? (
            <div className="tree-panel__rooms">
              <div className="tree-panel__room-group">
                <p className="tree-panel__room-group-title">Active room</p>
                <div className="tree-panel__room-row">
                  <button
                    type="button"
                    className={[
                      'tree-panel__room',
                      selectedNodeId === roomContents.nodeId || activeRoomNodeId === roomContents.nodeId
                        ? 'tree-panel__room--selected'
                        : ''
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    onClick={() => {
                      onSelectNode(roomContents.nodeId)
                    }}
                    data-room-node-id={roomContents.nodeId}
                    title={roomContents.label}
                  >
                    <span className="tree-panel__room-label-group">
                      <span className="tree-panel__room-label">{roomContents.label}</span>
                      <span className="tree-panel__room-number">#{roomContents.ifcId}</span>
                    </span>
                    {roomContents.roomNumber && (
                      <span className="tree-panel__room-meta">c. {roomContents.roomNumber}</span>
                    )}
                  </button>
                  <button
                    type="button"
                    className="tree-node__add"
                    onClick={(event) => {
                      event.stopPropagation()
                      const button = event.currentTarget as HTMLButtonElement
                      const row = button.closest('.tree-panel__room-row') as HTMLDivElement | null
                      const rect = row?.getBoundingClientRect() ?? button.getBoundingClientRect()
                      const anchorX = row ? rect.left + rect.width / 2 : rect.left
                      handleOpenMenu(roomContents.nodeId, { x: anchorX, y: rect.bottom })
                    }}
                    aria-label="Add child object"
                    title="Add child object"
                  >
                    +
                  </button>
                </div>
                {roomContentsNode.children.length > 0 ? (
                  <div className="tree-panel__room-contents-tree">
                    {roomContentsNode.children.map((childId) => (
                      <TreeNode
                        key={childId}
                        nodeId={childId}
                        depth={1}
                        expanded={expanded}
                        pathSet={selectionPath}
                        toggle={toggle}
                        onOpenMenu={handleOpenMenu}
                        selectedNodeId={selectedNodeId}
                        onSelectNode={onSelectNode}
                        nodes={tree.nodes}
                      />
                    ))}
                  </div>
                ) : (
                  <p className="tree-panel__status">No objects are linked to this room.</p>
                )}
              </div>
            </div>
          ) : (
            <p className="tree-panel__status">Select a room or room object to see its contents.</p>
          )
        ) : hasContent ? (
          tree.roots.map((rootId) => (
            <TreeNode
              key={rootId}
              nodeId={rootId}
              depth={0}
              expanded={expanded}
              pathSet={selectionPath}
              toggle={toggle}
              onOpenMenu={handleOpenMenu}
              selectedNodeId={selectedNodeId}
              onSelectNode={onSelectNode}
              nodes={tree.nodes}
            />
          ))
        ) : (
          <p className="tree-panel__status">Load an IFC model to see its hierarchy.</p>
        )}
      </div>
      <InsertMenu
        open={Boolean(menuAnchor && menuNodeId)}
        anchor={menuAnchor}
        alignX="center"
        prefabs={prefabs}
        onInsertPrefab={(prefabId) => {
          if (menuNodeId) {
            onInsertPrefab(menuNodeId, prefabId)
          }
          handleCloseMenu()
        }}
        onUploadClick={() => {
          if (menuNodeId) {
            onUploadModel(menuNodeId)
          }
          handleCloseMenu()
        }}
        onCancel={handleCloseMenu}
      />
    </section>
  )
}
