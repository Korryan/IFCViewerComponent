import type { ObjectTreePanelRoomRowProps } from './objectTreePanel.types'
import { resolveMenuAnchorFromButton } from './objectTreePanel.utils'

// Renders one room row with selection styling and the insert-child action.
export const ObjectTreePanelRoomRow = ({
  room,
  selected,
  onSelect,
  onOpenMenu
}: ObjectTreePanelRoomRowProps) => {
  return (
    <div className="tree-panel__room-row">
      <button
        type="button"
        className={[
          'tree-panel__room',
          selected ? 'tree-panel__room--selected' : ''
        ]
          .filter(Boolean)
          .join(' ')}
        onClick={() => onSelect(room.nodeId)}
        data-room-node-id={room.nodeId}
        title={room.label}
      >
        <span className="tree-panel__room-label-group">
          <span className="tree-panel__room-label">{room.label}</span>
          <span className="tree-panel__room-number">#{room.ifcId}</span>
        </span>
        {room.roomNumber && <span className="tree-panel__room-meta">c. {room.roomNumber}</span>}
      </button>
      <button
        type="button"
        className="tree-node__add"
        onClick={(event) => {
          event.stopPropagation()
          onOpenMenu(
            room.nodeId,
            resolveMenuAnchorFromButton(event.currentTarget, '.tree-panel__room-row')
          )
        }}
        aria-label="Add child object"
        title="Add child object"
      >
        +
      </button>
    </div>
  )
}
