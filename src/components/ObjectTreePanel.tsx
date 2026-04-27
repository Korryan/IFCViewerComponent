import { useEffect, useMemo, useRef, useState } from 'react'
import { InsertMenu } from './InsertMenu'
import { ObjectTreePanelRoomRow } from './ObjectTreePanelRoomRow'
import { ObjectTreePanelTreeNode } from './ObjectTreePanelTreeNode'
import type { MenuAnchor, ObjectTreePanelProps, ObjectTreePanelViewMode } from './objectTreePanel.types'
import {
  buildSelectionState,
  countDescendantNodes,
  groupRoomsByStorey,
  resolvePanelMenuAnchor
} from './objectTreePanel.utils'

// Renders the object tree panel and switches between tree, rooms, and active-room content views.
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
  const [menuAnchor, setMenuAnchor] = useState<MenuAnchor | null>(null)
  const [menuNodeId, setMenuNodeId] = useState<string | null>(null)
  const [viewMode, setViewMode] = useState<ObjectTreePanelViewMode>('tree')
  const contentRef = useRef<HTMLDivElement | null>(null)
  const panelRef = useRef<HTMLElement | null>(null)

  // This effect expands root nodes and clears any open insert menu whenever the root tree changes.
  useEffect(() => {
    const next = new Set<string>()
    tree.roots.forEach((rootId) => next.add(rootId))
    setExpanded(next)
    setMenuAnchor(null)
    setMenuNodeId(null)
  }, [tree.roots])

  // This effect keeps the current panel mode valid when room data or room-content state changes.
  useEffect(() => {
    if (viewMode === 'rooms' && rooms.length === 0) {
      setViewMode('tree')
    }
    if (viewMode === 'roomContents' && (!roomContents || !tree.nodes[roomContents.nodeId])) {
      setViewMode(rooms.length > 0 ? 'rooms' : 'tree')
    }
  }, [roomContents, rooms.length, tree.nodes, viewMode])

  const { selectionPath, selectionTrail } = useMemo(
    () => buildSelectionState(tree, selectedNodeId),
    [selectedNodeId, tree]
  )

  // This effect auto-expands the full ancestor path of the currently selected tree node.
  useEffect(() => {
    if (!selectedNodeId) return
    setExpanded((prev) => {
      const next = new Set(prev)
      selectionPath.forEach((id) => next.add(id))
      return next
    })
  }, [selectedNodeId, selectionPath])

  // This effect keeps the selected node or room centered inside the current scroll container.
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

  // This function toggles one tree node between expanded and collapsed state.
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

  const hasContent = tree.roots.length > 0
  const hasRooms = rooms.length > 0
  const hasRoomContents = Boolean(roomContents && tree.nodes[roomContents.nodeId])
  const roomContentsNode = hasRoomContents && roomContents ? tree.nodes[roomContents.nodeId] : null
  const isRoomMode = viewMode === 'rooms'
  const isRoomContentsMode = viewMode === 'roomContents'
  const roomGroups = useMemo(() => groupRoomsByStorey(rooms), [rooms])
  const roomContentsCount = useMemo(
    () => countDescendantNodes(tree, roomContentsNode?.id),
    [roomContentsNode?.id, tree]
  )

  // This function converts one viewport anchor into panel-local coordinates and opens the insert menu.
  const handleOpenMenu = (nodeId: string, anchor: MenuAnchor) => {
    const nextAnchor = resolvePanelMenuAnchor(panelRef.current, anchor)
    if (!nextAnchor) {
      setMenuAnchor(null)
      setMenuNodeId(null)
      return
    }
    setMenuAnchor(nextAnchor)
    setMenuNodeId(nodeId)
  }

  // This function closes the insert menu and clears its active tree target.
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
                    <ObjectTreePanelRoomRow
                      key={room.nodeId}
                      room={room}
                      selected={selectedNodeId === room.nodeId || activeRoomNodeId === room.nodeId}
                      onSelect={(nodeId) => (onSelectRoom ?? onSelectNode)(nodeId)}
                      onOpenMenu={handleOpenMenu}
                    />
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
                <ObjectTreePanelRoomRow
                  room={roomContents}
                  selected={selectedNodeId === roomContents.nodeId || activeRoomNodeId === roomContents.nodeId}
                  onSelect={onSelectNode}
                  onOpenMenu={handleOpenMenu}
                />
                {roomContentsNode.children.length > 0 ? (
                  <div className="tree-panel__room-contents-tree">
                    {roomContentsNode.children.map((childId) => (
                      <ObjectTreePanelTreeNode
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
            <ObjectTreePanelTreeNode
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
