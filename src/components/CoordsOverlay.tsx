import type { Point3D } from '../ifcViewerTypes'

// Lightweight HUD showing world coordinates under the cursor
type CoordsOverlayProps = {
  hoverCoords: Point3D | null
}

const overlayStyle: React.CSSProperties = {
  position: 'absolute',
  top: 8,
  left: 8,
  padding: '6px 10px',
  background: 'rgba(0,0,0,0.55)',
  color: '#fff',
  borderRadius: 6,
  fontSize: 12,
  pointerEvents: 'none',
  minWidth: 180
}

export const CoordsOverlay = ({ hoverCoords }: CoordsOverlayProps) => {
  return (
    <div className="coords-overlay" style={overlayStyle}>
      {hoverCoords ? (
        <span>
          X: {hoverCoords.x.toFixed(3)} Y: {hoverCoords.y.toFixed(3)} Z: {hoverCoords.z.toFixed(3)}
        </span>
      ) : (
        <span>Hover to see world coords</span>
      )}
    </div>
  )
}
