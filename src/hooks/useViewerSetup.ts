import { useCallback, type RefObject } from 'react'
import { Color } from 'three'
import CameraControls from 'camera-controls'
import { IfcViewerAPI } from 'web-ifc-viewer'

type EnsureViewerFn = () => IfcViewerAPI | null
type ViewerHandleRef = { current: IfcViewerAPI | null }

export const useViewerSetup = (
  containerRef: RefObject<HTMLDivElement | null>,
  viewerRef: ViewerHandleRef,
  wasmRootPath: string
): EnsureViewerFn => {
  // Lazy-initialize the underlying IfcViewerAPI once the div ref is ready
  // Also configures controls, grid/axes, and WASM location
  return useCallback(() => {
    if (viewerRef.current || !containerRef.current) {
      return viewerRef.current
    }

    const viewer = new IfcViewerAPI({
      container: containerRef.current,
      backgroundColor: new Color(0xf3f4f6)
    })

    viewer.axes.setAxes()
    viewer.grid.setGrid()
    viewer.IFC.setWasmPath(wasmRootPath)
    viewer.context.renderer.postProduction.active = true
    const cameraControls = viewer.context.ifcCamera.cameraControls
    cameraControls.mouseButtons.left = CameraControls.ACTION.NONE
    cameraControls.mouseButtons.middle = CameraControls.ACTION.ROTATE
    cameraControls.mouseButtons.right = CameraControls.ACTION.TRUCK
    cameraControls.mouseButtons.wheel = CameraControls.ACTION.DOLLY

    viewerRef.current = viewer
    return viewer
  }, [containerRef, viewerRef, wasmRootPath])
}
