export const wasmRootPath = '/ifc/'
export const CUBE_ITEM_PREFIX = 'cube-'
export const UPLOADED_ITEM_PREFIX = 'uploaded-'
export const MOVE_DELTA_CUSTOM_KEY = '__bakaMoveDeltaJson'
export const ROTATE_DELTA_CUSTOM_KEY = '__bakaRotateDeltaJson'
export const POSITION_EPSILON = 1e-4
export const ROTATION_EPSILON = 1e-4
export const ROTATE_DRAG_SENSITIVITY = 0.02
export const WALK_MOVE_SPEED = 2.8
export const WALK_LOOK_SENSITIVITY = 0.00125
export const WALK_PITCH_LIMIT = Math.PI / 2 - 0.05
export const WALK_DRAG_MOVE_PER_PIXEL = 0.02
export const FREE_WHEEL_MOVE_FACTOR = 0.0067
export const FREE_WHEEL_MAX_DELTA = 240
export const ROOM_SELECT_Y_OFFSET = 1
export const MODEL_LOAD_TIMEOUT_MS = 60_000
export const IFC_LOADER_SETTINGS = {
  COORDINATE_TO_ORIGIN: true,
  USE_FAST_BOOLS: false
}
export const ROOM_NUMBER_KEYS = new Set([
  'raumnummer',
  'roomnumber'
])
export const ENABLE_ROOM_NUMBER_GROUPING = false
export const MAX_ROOM_NUMBER_LOOKUPS = 400
export const ROOM_NUMBER_BATCH_SIZE = 20
export const CONTAINMENT_RELATION_BATCH_SIZE = 20
export const MAX_CONTAINMENT_RELATION_LOOKUPS = 800
export const UNKNOWN_TREE_TYPE_BATCH_SIZE = 20
export const MAX_UNKNOWN_TREE_TYPE_LOOKUPS = 1200
export const SHORTCUTS = [
  { keys: 'M', label: 'Toggle free look / walk mode' },
  { keys: 'Arrow Keys', label: 'Move in walk mode (fixed height)' },
  { keys: 'Middle Mouse Drag (walk)', label: 'Rotate camera' },
  { keys: 'Right Mouse Drag (walk)', label: 'Move in floor plane' },
  { keys: 'A (free mode)', label: 'Open insert menu at cursor' },
  { keys: 'G', label: 'Start move mode' },
  { keys: 'R', label: 'Start rotate mode' },
  { keys: 'X / Y / Z', label: 'Lock axis while moving / rotating' },
  { keys: 'F', label: 'Move in floor plane (keep height)' },
  { keys: 'Left Click', label: 'Pick element / open overlap menu' },
  { keys: 'Esc', label: 'Cancel drag / close menus' },
  { keys: '? / H', label: 'Toggle shortcuts help' }
]
