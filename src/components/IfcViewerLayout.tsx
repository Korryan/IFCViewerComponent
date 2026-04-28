import type { ChangeEvent, MutableRefObject, RefObject } from 'react'
import type {
  HistoryEntry,
  InsertPrefabOption,
  OffsetVector,
  PropertyField,
  SelectedElement
} from '../ifcViewerTypes'
import type { ObjectTree } from '../ifcViewerTypes'
import type { RoomListEntry } from '../ifcViewer.rooms'
import { CUSTOM_CUBE_MODEL_ID } from '../hooks/selectionOffsets.shared'
import { CoordsOverlay } from './CoordsOverlay'
import { InsertMenu } from './InsertMenu'
import { PropertiesPanel } from './PropertiesPanel'
import { ObjectTreePanel } from './ObjectTreePanel'
import { ShortcutsOverlay } from './ShortcutsOverlay'
import { SelectionMenu } from './SelectionMenu'

type IfcViewerLayoutProps = {
  containerRef: RefObject<HTMLDivElement | null>
  uploadInputRef: MutableRefObject<HTMLInputElement | null>
  treeUploadInputRef: MutableRefObject<HTMLInputElement | null>
  hoverCoords: { x: number; y: number; z: number } | null
  isInsertMenuOpen: boolean
  insertMenuAnchor: { x: number; y: number } | null
  prefabs: InsertPrefabOption[]
  onInsertPrefab: (prefabId: string) => void
  onCloseInsertMenu: () => void
  isPickMenuOpen: boolean
  pickMenuAnchor: { x: number; y: number } | null
  pickMenuItems: Array<{ id: string; label: string; meta?: string | null }>
  onPickMenuSelect: (id: string) => void
  onClosePickMenu: () => void
  isWalkMode: boolean
  onToggleNavigationMode: () => void
  roomOnlyTransformGuard: boolean
  onToggleRoomOnlyTransformGuard: () => void
  status: string | null
  error: string | null
  showShortcuts: boolean
  isShortcutsOpen: boolean
  shortcuts: Array<{ keys: string; label: string }>
  onToggleShortcuts: () => void
  onCloseShortcuts: () => void
  showSidePanel: boolean
  showTree: boolean
  showProperties: boolean
  tree: ObjectTree
  selectedNodeId: string | null
  onSelectNode: (nodeId: string) => void
  rooms: RoomListEntry[]
  roomContents: RoomListEntry | null
  activeRoomNodeId: string | null
  onSelectRoom: (nodeId: string) => void
  onInsertPrefabAtNode: (nodeId: string, prefabId: string) => void
  onUploadModelAtNode: (nodeId: string) => void
  selectedElement: SelectedElement | null
  isFetchingProperties: boolean
  propertyError: string | null
  offsetInputs: OffsetVector
  onOffsetChange: (axis: keyof OffsetVector, value: number) => void
  onApplyOffset: () => void
  canTransformSelected: boolean
  transformGuardReason: string | null
  onDeleteSelected?: () => void
  elementName: string | null
  historyEntries: HistoryEntry[]
  propertyFields: PropertyField[]
  onFieldChange: (key: string, value: string) => void
  onUploadInputChange: (event: ChangeEvent<HTMLInputElement>) => Promise<void>
  onTreeUploadInputChange: (event: ChangeEvent<HTMLInputElement>) => void
}

// Renders the full IFC viewer layout with overlays, side panels, and hidden upload inputs.
export const IfcViewerLayout = ({
  containerRef,
  uploadInputRef,
  treeUploadInputRef,
  hoverCoords,
  isInsertMenuOpen,
  insertMenuAnchor,
  prefabs,
  onInsertPrefab,
  onCloseInsertMenu,
  isPickMenuOpen,
  pickMenuAnchor,
  pickMenuItems,
  onPickMenuSelect,
  onClosePickMenu,
  isWalkMode,
  onToggleNavigationMode,
  roomOnlyTransformGuard,
  onToggleRoomOnlyTransformGuard,
  status,
  error,
  showShortcuts,
  isShortcutsOpen,
  shortcuts,
  onToggleShortcuts,
  onCloseShortcuts,
  showSidePanel,
  showTree,
  showProperties,
  tree,
  selectedNodeId,
  onSelectNode,
  rooms,
  roomContents,
  activeRoomNodeId,
  onSelectRoom,
  onInsertPrefabAtNode,
  onUploadModelAtNode,
  selectedElement,
  isFetchingProperties,
  propertyError,
  offsetInputs,
  onOffsetChange,
  onApplyOffset,
  canTransformSelected,
  transformGuardReason,
  onDeleteSelected,
  elementName,
  historyEntries,
  propertyFields,
  onFieldChange,
  onUploadInputChange,
  onTreeUploadInputChange
}: IfcViewerLayoutProps) => {
  return (
    <>
      <div className="viewer-wrapper">
        <div className="viewer-layout">
          <div className="viewer-stage">
            <div ref={containerRef} className="viewer-container" />
            <CoordsOverlay hoverCoords={hoverCoords} />
            <InsertMenu
              open={isInsertMenuOpen}
              anchor={insertMenuAnchor}
              prefabs={prefabs}
              onInsertPrefab={(prefabId) => {
                onInsertPrefab(prefabId)
                onCloseInsertMenu()
              }}
              onUploadClick={() => uploadInputRef.current?.click()}
              onCancel={onCloseInsertMenu}
            />
            <SelectionMenu
              open={isPickMenuOpen}
              anchor={pickMenuAnchor}
              candidates={pickMenuItems.map((item) => ({
                ...item,
                meta: item.meta ?? undefined
              }))}
              onSelect={onPickMenuSelect}
              onCancel={onClosePickMenu}
            />
            <div className={`viewer-mode-controls${showShortcuts ? ' viewer-mode-controls--with-shortcuts' : ''}`}>
              <button
                type="button"
                className={`navigation-toggle${isWalkMode ? ' navigation-toggle--walk' : ''}`}
                onClick={onToggleNavigationMode}
                title={isWalkMode ? 'Switch to free look mode' : 'Switch to walk mode'}
              >
                {isWalkMode ? 'Walk mode' : 'Free mode'}
              </button>
              <button
                type="button"
                className={`navigation-toggle navigation-toggle--room-guard${roomOnlyTransformGuard ? ' navigation-toggle--room-guard-active' : ''}`}
                onClick={onToggleRoomOnlyTransformGuard}
                aria-pressed={roomOnlyTransformGuard}
                title="Lock movement and rotation for elements outside rooms"
              >
                Room-only edit {roomOnlyTransformGuard ? 'On' : 'Off'}
              </button>
            </div>
            {status && <div className="viewer-overlay">{status}</div>}
            {error && <div className="viewer-overlay viewer-overlay--error">{error}</div>}
            {showShortcuts && (
              <>
                <button
                  type="button"
                  className="shortcuts-toggle"
                  onClick={onToggleShortcuts}
                  title="Keyboard shortcuts"
                >
                  ?
                </button>
                <ShortcutsOverlay
                  open={isShortcutsOpen}
                  shortcuts={shortcuts}
                  onClose={onCloseShortcuts}
                />
              </>
            )}
          </div>

          {showSidePanel && (
            <div className="side-panel">
              {showTree && (
                <ObjectTreePanel
                  tree={tree}
                  selectedNodeId={selectedNodeId}
                  onSelectNode={onSelectNode}
                  rooms={rooms}
                  roomContents={roomContents}
                  activeRoomNodeId={activeRoomNodeId}
                  onSelectRoom={onSelectRoom}
                  prefabs={prefabs}
                  onInsertPrefab={onInsertPrefabAtNode}
                  onUploadModel={onUploadModelAtNode}
                />
              )}
              {showProperties && (
                <PropertiesPanel
                  selectedElement={selectedElement}
                  isFetchingProperties={isFetchingProperties}
                  propertyError={propertyError}
                  offsetInputs={offsetInputs}
                  onOffsetChange={onOffsetChange}
                  onApplyOffset={onApplyOffset}
                  canTransformSelected={canTransformSelected}
                  transformGuardReason={transformGuardReason}
                  shortcutsHint={showShortcuts ? 'Shortcuts: press ? or H' : undefined}
                  onShowShortcuts={showShortcuts ? onToggleShortcuts : undefined}
                  onDeleteSelected={selectedElement ? onDeleteSelected : undefined}
                  deleteLabel={
                    selectedElement?.modelID === CUSTOM_CUBE_MODEL_ID
                      ? 'Delete object'
                      : 'Delete element'
                  }
                  elementName={elementName}
                  historyEntries={historyEntries}
                  propertyFields={propertyFields}
                  onFieldChange={onFieldChange}
                />
              )}
            </div>
          )}
        </div>
      </div>
      <input
        type="file"
        accept=".ifc"
        style={{ display: 'none' }}
        ref={uploadInputRef}
        onChange={(event) => {
          void onUploadInputChange(event)
        }}
      />
      <input
        type="file"
        accept=".ifc"
        style={{ display: 'none' }}
        ref={treeUploadInputRef}
        onChange={onTreeUploadInputChange}
      />
    </>
  )
}
