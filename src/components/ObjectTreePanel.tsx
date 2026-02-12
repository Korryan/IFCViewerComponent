import { useEffect, useMemo, useRef, useState } from 'react'
import type { ObjectTree } from '../ifcViewerTypes'
import { InsertMenu } from './InsertMenu'

type ObjectTreePanelProps = {
  tree: ObjectTree
  selectedNodeId: string | null
  onSelectNode: (nodeId: string) => void
  onAddCube: (nodeId: string) => void
  onUploadModel: (nodeId: string) => void
  filters?: { key: string; label: string; active: boolean }[]
  hasActiveFilters?: boolean
  filtersDisabled?: boolean
  onToggleFilter?: (key: string) => void
  onResetFilters?: () => void
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
          title={node.label}
          data-node-id={nodeId}
        >
          <span className="tree-node__type">{node.type}</span>
          <span className="tree-node__name">{node.label}</span>
        </button>
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
  onAddCube,
  onUploadModel,
  filters = [],
  hasActiveFilters = false,
  filtersDisabled = false,
  onToggleFilter,
  onResetFilters
}: ObjectTreePanelProps) => {
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [menuAnchor, setMenuAnchor] = useState<{ x: number; y: number } | null>(null)
  const [menuNodeId, setMenuNodeId] = useState<string | null>(null)
  const [filtersOpen, setFiltersOpen] = useState(false)
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
    if (filtersDisabled) {
      setFiltersOpen(false)
    }
  }, [filtersDisabled])

  useEffect(() => {
    if (!filtersOpen) return
    const handlePointerDown = (event: PointerEvent) => {
      const panel = panelRef.current
      if (!panel) return
      if (!panel.contains(event.target as Node)) {
        setFiltersOpen(false)
      }
    }
    window.addEventListener('pointerdown', handlePointerDown)
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown)
    }
  }, [filtersOpen])

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
    const target = container.querySelector(`[data-node-id="${selectedNodeId}"]`)
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
      {filters.length > 0 && (
        <div className="tree-panel__actions">
          <button
            type="button"
            className={[
              'tree-panel__filters-toggle',
              hasActiveFilters ? 'tree-panel__filters-toggle--active' : ''
            ]
              .filter(Boolean)
              .join(' ')}
            onClick={() => setFiltersOpen((prev) => !prev)}
            disabled={filtersDisabled}
          >
            Filters
            {hasActiveFilters ? ` (${filters.filter((f) => f.active).length})` : ''}
          </button>
          {filtersOpen && (
            <div className="tree-panel__filters-dropdown" role="menu">
              <div className="tree-panel__filters-header">
                <h3>View filters</h3>
                <button
                  type="button"
                  className="tree-panel__filters-reset"
                  onClick={() => onResetFilters?.()}
                  disabled={!hasActiveFilters || filtersDisabled}
                >
                  Reset
                </button>
              </div>
              <div className="tree-panel__filters-grid">
                {filters.map((filter) => (
                  <label
                    key={filter.key}
                    className={[
                      'tree-panel__filter',
                      filter.active ? 'tree-panel__filter--active' : ''
                    ]
                      .filter(Boolean)
                      .join(' ')}
                  >
                    <input
                      type="checkbox"
                      checked={filter.active}
                      onChange={() => onToggleFilter?.(filter.key)}
                      disabled={filtersDisabled}
                    />
                    <span>{filter.label}</span>
                  </label>
                ))}
              </div>
              <p className="tree-panel__filters-hint">Show only selected IFC types.</p>
            </div>
          )}
        </div>
      )}
      <div ref={contentRef} className="tree-panel__content">
        {hasContent ? (
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
        onInsertCube={() => {
          if (menuNodeId) {
            onAddCube(menuNodeId)
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
