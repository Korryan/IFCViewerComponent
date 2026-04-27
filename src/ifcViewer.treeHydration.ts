import {
  buildIfcTree
} from './hooks/useObjectTree'
import { enrichIfcTree } from './ifcViewer.treeHydration.enrichment'
import {
  handleTreeBuildFailure,
  isCurrentTreeLoad
} from './ifcViewer.treeHydration.shared'
import type { TreeRebuildArgs } from './ifcViewer.treeHydration.types'

// This rebuilds the tree for one IFC model and then starts the asynchronous enrichment pipeline.
export const rebuildIfcTreeForModel = async (args: TreeRebuildArgs) => {
  const {
    viewer,
    modelID,
    loadToken,
    activeIfcText,
    isLoadTokenCurrent,
    setIfcTree,
    resetTree,
    setSelectedNodeId,
    setStoreyInfoByNodeId,
    setRoomNumbers
  } = args

  try {
    const spatial = await viewer.IFC.getSpatialStructure(modelID)
    if (!isCurrentTreeLoad(loadToken, isLoadTokenCurrent)) return

    try {
      const rawTree = buildIfcTree(spatial, modelID)
      if (!isCurrentTreeLoad(loadToken, isLoadTokenCurrent)) return

      setRoomNumbers(new Map())
      setStoreyInfoByNodeId({})
      setIfcTree(rawTree, modelID)
      setSelectedNodeId(rawTree.roots[0] ?? null)

      void enrichIfcTree({
        viewer,
        tree: rawTree,
        modelID,
        loadToken,
        activeIfcText,
        isLoadTokenCurrent,
        setIfcTree,
        setStoreyInfoByNodeId,
        setRoomNumbers
      })
    } catch (err) {
      handleTreeBuildFailure(err, {
        resetTree,
        setSelectedNodeId,
        setStoreyInfoByNodeId
      })
    }
  } catch (err) {
    if (!isCurrentTreeLoad(loadToken, isLoadTokenCurrent)) return
    handleTreeBuildFailure(err, {
      resetTree,
      setSelectedNodeId,
      setStoreyInfoByNodeId
    })
  }
}
