import { localizeIfcType } from '../utils/ifcTypeLocalization'
import type { ObjectTreePanelTreeNodeProps } from './objectTreePanel.types'
import {
  canNodeAcceptChildren,
  getNodeIfcDisplayId,
  resolveMenuAnchorFromButton,
  shouldShowNodeTypeBadge
} from './objectTreePanel.utils'

const indentSize = 12

// Renders one recursive object-tree node including selection state, expand/collapse, and insert action.
export const ObjectTreePanelTreeNode = ({
  nodeId,
  depth,
  expanded,
  pathSet,
  toggle,
  onOpenMenu,
  selectedNodeId,
  onSelectNode,
  nodes
}: ObjectTreePanelTreeNodeProps) => {
  const node = nodes[nodeId]
  if (!node) return null

  const hasChildren = node.children.length > 0
  const isExpanded = expanded.has(nodeId)
  const isSelected = selectedNodeId === nodeId
  const isOnPath = pathSet.has(nodeId)
  const localizedType = localizeIfcType(node.type)
  const ifcDisplayId = getNodeIfcDisplayId(node)
  const showTypeBadge = shouldShowNodeTypeBadge(node, localizedType)
  const canAddChild = canNodeAcceptChildren(node)

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
              onOpenMenu(
                nodeId,
                resolveMenuAnchorFromButton(event.currentTarget, '.tree-node__row')
              )
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
            <ObjectTreePanelTreeNode
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
