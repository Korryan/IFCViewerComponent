import type { Point3D } from '../ifcViewerTypes'
import type { IfcViewerAPI } from '../viewer/IfcViewerAPICompat'

// This function reads the current IFC hover hit and converts it into the shared point shape.
export const readHoverCoords = (viewer: IfcViewerAPI | null): Point3D | null => {
  const hit = viewer?.context.castRayIfc()
  if (!hit?.point) {
    return null
  }

  return {
    x: hit.point.x,
    y: hit.point.y,
    z: hit.point.z
  }
}
