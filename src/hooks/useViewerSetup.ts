import { useCallback, type RefObject } from 'react'
import { Color } from 'three'
import CameraControls from 'camera-controls'
import { IfcViewerAPI } from '../viewer/IfcViewerAPICompat'

type EnsureViewerFn = () => IfcViewerAPI | null
type ViewerHandleRef = { current: IfcViewerAPI | null }

const PERSPECTIVE_NEAR = 0.2
const PERSPECTIVE_FAR = 2000
const ORTHOGRAPHIC_NEAR = 0.2
const ORTHOGRAPHIC_FAR = 2000

export const useViewerSetup = (
  containerRef: RefObject<HTMLDivElement | null>,
  viewerRef: ViewerHandleRef,
  wasmRootPath: string
): EnsureViewerFn => {
  // Lazy-initialize the underlying IfcViewerAPI once the div ref is ready
  // Also configures controls and WASM location
  return useCallback(() => {
    if (viewerRef.current || !containerRef.current) {
      return viewerRef.current
    }

    try {
      const viewer = new IfcViewerAPI({
        container: containerRef.current,
        backgroundColor: new Color(0xf3f4f6)
      })

      viewer.IFC.setWasmPath(wasmRootPath)
      // Keep outlines and postprocessing fully disabled.
      viewer.context.renderer.postProduction.active = false

      // Explicit camera clip planes help reduce depth precision artifacts on IFC geometry.
      const perspectiveCamera = viewer.context.ifcCamera.perspectiveCamera
      perspectiveCamera.near = PERSPECTIVE_NEAR
      perspectiveCamera.far = PERSPECTIVE_FAR
      perspectiveCamera.updateProjectionMatrix()

      const orthographicCamera = viewer.context.ifcCamera.orthographicCamera
      orthographicCamera.near = ORTHOGRAPHIC_NEAR
      orthographicCamera.far = ORTHOGRAPHIC_FAR
      orthographicCamera.updateProjectionMatrix()

      const cameraControls = viewer.context.ifcCamera.cameraControls
      cameraControls.mouseButtons.left = CameraControls.ACTION.NONE
      cameraControls.mouseButtons.middle = CameraControls.ACTION.ROTATE
      cameraControls.mouseButtons.right = CameraControls.ACTION.TRUCK
      cameraControls.mouseButtons.wheel = CameraControls.ACTION.NONE

      viewerRef.current = viewer
      return viewer
    } catch (error) {
      console.error('Failed to initialize IFC viewer', error)
      return null
    }
  }, [containerRef, viewerRef, wasmRootPath])
}
