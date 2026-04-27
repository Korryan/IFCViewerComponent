import type { ObjectTree } from './ifcViewerTypes'
import type { TreeRebuildStateHandlers } from './ifcViewer.treeHydration.types'

// Checks whether the current async tree hydration task still belongs to the active model load.
export const isCurrentTreeLoad = (
  loadToken: number,
  isLoadTokenCurrent: (token: number) => boolean
) => isLoadTokenCurrent(loadToken)

// Resets tree-related UI state after a failed IFC tree build or hydration pass.
export const resetTreeBuildState = (
  handlers: Pick<TreeRebuildStateHandlers, 'resetTree' | 'setSelectedNodeId' | 'setStoreyInfoByNodeId'>
) => {
  handlers.resetTree()
  handlers.setSelectedNodeId(null)
  handlers.setStoreyInfoByNodeId({})
}

// Applies one rebuilt tree snapshot only when it actually differs from the current snapshot.
export const updateIfcTreeIfChanged = (args: {
  currentTree: ObjectTree
  nextTree: ObjectTree
  modelID: number
  setIfcTree: (tree: ObjectTree, modelID: number) => void
}) => {
  if (args.nextTree === args.currentTree) {
    return args.currentTree
  }
  args.setIfcTree(args.nextTree, args.modelID)
  return args.nextTree
}

// Logs one tree-build failure and resets the related UI state in one step.
export const handleTreeBuildFailure = (
  error: unknown,
  handlers: Pick<TreeRebuildStateHandlers, 'resetTree' | 'setSelectedNodeId' | 'setStoreyInfoByNodeId'>
) => {
  console.error('Failed to build IFC tree', error)
  resetTreeBuildState(handlers)
}
