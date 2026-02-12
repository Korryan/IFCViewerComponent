type InsertMenuProps = {
  open: boolean
  anchor: { x: number; y: number } | null
  onInsertCube: () => void
  onUploadClick: () => void
  onCancel: () => void
  alignX?: 'left' | 'center'
}

// Small contextual menu for inserting cubes or uploading IFC near the cursor
const menuStyleBase: React.CSSProperties = {
  position: 'absolute',
  padding: '8px 10px',
  background: 'rgba(17, 24, 39, 0.92)',
  color: '#fff',
  borderRadius: 8,
  display: 'grid',
  gap: 6,
  minWidth: 180,
  zIndex: 2
}

const primaryBtn: React.CSSProperties = {
  padding: '6px 10px',
  background: '#4f46e5',
  color: '#fff',
  border: 'none',
  borderRadius: 6,
  cursor: 'pointer'
}

const secondaryBtn: React.CSSProperties = {
  padding: '6px 10px',
  background: '#374151',
  color: '#fff',
  border: 'none',
  borderRadius: 6,
  cursor: 'pointer'
}

const cancelBtn: React.CSSProperties = {
  padding: '4px 8px',
  background: 'transparent',
  color: '#cbd5e1',
  border: '1px solid #4b5563',
  borderRadius: 6,
  cursor: 'pointer'
}

export const InsertMenu = ({
  open,
  anchor,
  onInsertCube,
  onUploadClick,
  onCancel,
  alignX = 'left'
}: InsertMenuProps) => {
  if (!open) return null
  return (
    <div
      style={{
        ...menuStyleBase,
        top: anchor ? anchor.y : 50,
        left: anchor ? anchor.x : 8,
        transform: alignX === 'center' ? 'translateX(-50%)' : 'none'
      }}
    >
      <button type="button" style={primaryBtn} onClick={onInsertCube}>
        Insert 1×1×1 cube
      </button>
      <button type="button" style={secondaryBtn} onClick={onUploadClick}>
        Upload IFC model
      </button>
      <button type="button" style={cancelBtn} onClick={onCancel}>
        Cancel
      </button>
    </div>
  )
}
