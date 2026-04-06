import CameraControls from 'camera-controls'
import { Box3, Object3D, OrthographicCamera, PerspectiveCamera, Scene, Vector3 } from 'three'

type ViewerItems = {
  ifcModels: Object3D[]
  pickableIfcModels: Object3D[]
}

// Adds one object to the pickable list only when it is not already registered.
export const addPickableObject = (items: ViewerItems, object: Object3D) => {
  if (!items.pickableIfcModels.includes(object)) {
    items.pickableIfcModels.push(object)
  }
}

// Removes one object from the pickable list if it is currently registered.
export const removePickableObject = (items: ViewerItems, object: Object3D) => {
  const index = items.pickableIfcModels.indexOf(object)
  if (index !== -1) {
    items.pickableIfcModels.splice(index, 1)
  }
}

// Removes one IFC model entry from the visible model list if it is currently present.
export const removeModelFromSceneList = (items: ViewerItems, model: Object3D) => {
  const index = items.ifcModels.indexOf(model)
  if (index !== -1) {
    items.ifcModels.splice(index, 1)
  }
}

// Computes the current scene radius from all visible IFC models and falls back to a safe default when empty.
export const computeSceneRadius = (models: Object3D[]) => {
  if (models.length === 0) {
    return 50
  }

  const box = new Box3()
  let hasBox = false
  for (const model of models) {
    const modelBox = new Box3().setFromObject(model)
    if (!Number.isFinite(modelBox.min.x) || !Number.isFinite(modelBox.max.x)) continue
    if (!hasBox) {
      box.copy(modelBox)
      hasBox = true
    } else {
      box.union(modelBox)
    }
  }

  if (!hasBox) {
    return 50
  }

  const size = box.getSize(new Vector3())
  return Math.max(size.x, size.y, size.z) * 0.5 + 1
}

// Updates near and far clip planes for both cameras based on the current controls distance and scene radius.
export const updateCameraClipPlanesForScene = (args: {
  cameraControls: CameraControls
  perspectiveCamera: PerspectiveCamera
  orthographicCamera: OrthographicCamera
  sceneRadius: number
}) => {
  const position = new Vector3()
  const target = new Vector3()
  args.cameraControls.getPosition(position)
  args.cameraControls.getTarget(target)

  const distance = Math.max(1, position.distanceTo(target))
  const radius = Math.max(5, args.sceneRadius)
  const near = Math.max(0.2, Math.min(2, distance / 120))
  const far = Math.max(150, distance + radius * 4)

  if (
    Math.abs(args.perspectiveCamera.near - near) > 1e-3 ||
    Math.abs(args.perspectiveCamera.far - far) > 1e-2
  ) {
    args.perspectiveCamera.near = near
    args.perspectiveCamera.far = far
    args.perspectiveCamera.updateProjectionMatrix()
  }

  if (
    Math.abs(args.orthographicCamera.near - near) > 1e-3 ||
    Math.abs(args.orthographicCamera.far - far) > 1e-2
  ) {
    args.orthographicCamera.near = near
    args.orthographicCamera.far = far
    args.orthographicCamera.updateProjectionMatrix()
  }
}

// Adds one IFC model into the scene and tracking lists without duplicating scene or list entries.
export const attachIfcModelToScene = (args: {
  scene: Scene
  items: ViewerItems
  mesh: Object3D | null | undefined
}) => {
  if (!args.mesh) return
  if (!args.scene.children.includes(args.mesh)) {
    args.scene.add(args.mesh)
  }
  if (!args.items.ifcModels.includes(args.mesh)) {
    args.items.ifcModels.push(args.mesh)
  }
  addPickableObject(args.items, args.mesh)
}
