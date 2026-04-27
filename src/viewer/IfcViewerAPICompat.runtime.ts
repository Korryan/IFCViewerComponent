import CameraControls from 'camera-controls'
import {
  AmbientLight,
  Box3,
  DirectionalLight,
  HemisphereLight,
  Object3D,
  OrthographicCamera,
  PerspectiveCamera,
  Scene,
  Vector2,
  Vector3,
  WebGLRenderer
} from 'three'

// Adds the default scene lights used by the compatibility viewer.
export const setupDefaultSceneLights = (scene: Scene) => {
  const ambient = new AmbientLight(0xffffff, 0.42)
  const hemi = new HemisphereLight(0xe5f2ff, 0xd6c9b7, 0.3)
  const key = new DirectionalLight(0xffffff, 0.72)
  const fill = new DirectionalLight(0xffffff, 0.28)
  const rim = new DirectionalLight(0xffffff, 0.16)

  key.position.set(24, 32, 18)
  fill.position.set(-18, 14, -20)
  rim.position.set(4, 20, -28)

  scene.add(ambient)
  scene.add(hemi)
  scene.add(key)
  scene.add(fill)
  scene.add(rim)
}

// Updates the normalized pointer position used by viewer raycasting.
export const updateViewerPointerPosition = (args: {
  container: HTMLElement
  mousePosition: Vector2
  event: PointerEvent
}) => {
  const rect = args.container.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0) return
  args.mousePosition.x = ((args.event.clientX - rect.left) / rect.width) * 2 - 1
  args.mousePosition.y = -((args.event.clientY - rect.top) / rect.height) * 2 + 1
}

// Resizes the renderer and both cameras to match the current container size.
export const resizeViewerViewport = (args: {
  container: HTMLElement
  renderer: WebGLRenderer
  perspectiveCamera: PerspectiveCamera
  orthographicCamera: OrthographicCamera
  updateCameraClipPlanes: () => void
}) => {
  const width = Math.max(1, args.container.clientWidth)
  const height = Math.max(1, args.container.clientHeight)
  args.renderer.setSize(width, height)
  args.perspectiveCamera.aspect = width / height
  args.perspectiveCamera.updateProjectionMatrix()

  const frustumHeight = 20
  const frustumWidth = frustumHeight * (width / height)
  args.orthographicCamera.left = -frustumWidth / 2
  args.orthographicCamera.right = frustumWidth / 2
  args.orthographicCamera.top = frustumHeight / 2
  args.orthographicCamera.bottom = -frustumHeight / 2
  args.orthographicCamera.updateProjectionMatrix()
  args.updateCameraClipPlanes()
}

// Advances camera controls and renders one viewer animation frame.
export const renderViewerFrame = (args: {
  now: number
  lastFrameTime: number
  cameraControls: CameraControls
  updateCameraClipPlanes: () => void
  renderer: WebGLRenderer
  scene: Scene
  perspectiveCamera: PerspectiveCamera
}) => {
  const delta = Math.max(0, (args.now - args.lastFrameTime) / 1000)
  args.cameraControls.update(delta)
  args.updateCameraClipPlanes()
  args.renderer.render(args.scene, args.perspectiveCamera)
}

// Fits the camera onto all currently visible IFC models and returns the resulting scene radius.
export const fitCameraToVisibleModels = async (args: {
  cameraControls: CameraControls
  models: Object3D[]
  updateCameraClipPlanes: () => void
}): Promise<number | null> => {
  if (args.models.length === 0) return null

  const box = new Box3()
  let hasBox = false
  for (const model of args.models) {
    const modelBox = new Box3().setFromObject(model)
    if (!Number.isFinite(modelBox.min.x) || !Number.isFinite(modelBox.max.x)) continue
    if (!hasBox) {
      box.copy(modelBox)
      hasBox = true
    } else {
      box.union(modelBox)
    }
  }
  if (!hasBox) return null

  const center = box.getCenter(new Vector3())
  const size = box.getSize(new Vector3())
  const sceneRadius = Math.max(size.x, size.y, size.z) * 0.5 + 1
  const radius = Math.max(size.x, size.y, size.z) * 0.8 + 2
  const nextPos = center.clone().add(new Vector3(radius, radius * 0.6, radius))

  await args.cameraControls.setLookAt(
    nextPos.x,
    nextPos.y,
    nextPos.z,
    center.x,
    center.y,
    center.z,
    true
  )

  args.updateCameraClipPlanes()
  return sceneRadius
}
