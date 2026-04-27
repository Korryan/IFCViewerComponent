import { ENABLE_ROOM_NUMBER_GROUPING } from './ifcViewer.constants'
import {
  buildRoomNumberMap,
  buildStoreyInfoMap
} from './ifcRoomTree.utils'
import {
  groupIfcTreeByRoomNumber,
  groupIfcTreeBySpatialContainment
} from './hooks/useObjectTree'
import { buildSpatialContainmentMap } from './ifcViewer.treeHydration.containment'
import {
  isCurrentTreeLoad,
  updateIfcTreeIfChanged
} from './ifcViewer.treeHydration.shared'
import type { TreeEnrichmentArgs } from './ifcViewer.treeHydration.types'
import { hydrateUnknownIfcNodeTypes } from './ifcViewer.treeHydration.unknown'

// Enriches a raw spatial tree with storey data, concrete IFC labels and room grouping in the background.
export const enrichIfcTree = async (args: TreeEnrichmentArgs) => {
  const {
    viewer,
    tree,
    modelID,
    loadToken,
    activeIfcText,
    isLoadTokenCurrent,
    setIfcTree,
    setStoreyInfoByNodeId,
    setRoomNumbers
  } = args

  let nextTree = tree

  try {
    const storeyInfo = await buildStoreyInfoMap(viewer, tree, modelID)
    if (!isCurrentTreeLoad(loadToken, isLoadTokenCurrent)) return
    setStoreyInfoByNodeId(Object.fromEntries(storeyInfo))
  } catch (err) {
    console.warn('Failed to read storey elevation info', err)
  }

  try {
    const hydratedTree = await hydrateUnknownIfcNodeTypes({
      viewer,
      tree: nextTree,
      modelID,
      loadToken,
      isLoadTokenCurrent
    })
    if (!isCurrentTreeLoad(loadToken, isLoadTokenCurrent)) return
    nextTree = updateIfcTreeIfChanged({
      currentTree: nextTree,
      nextTree: hydratedTree,
      modelID,
      setIfcTree
    })
  } catch (err) {
    console.warn('Failed to hydrate UNKNOWN IFC node labels', err)
  }

  try {
    const containmentMap = await buildSpatialContainmentMap({
      viewer,
      tree: nextTree,
      modelID,
      loadToken,
      isLoadTokenCurrent
    })
    if (!isCurrentTreeLoad(loadToken, isLoadTokenCurrent)) return

    nextTree = updateIfcTreeIfChanged({
      currentTree: nextTree,
      nextTree: groupIfcTreeBySpatialContainment(nextTree, containmentMap),
      modelID,
      setIfcTree
    })
  } catch (err) {
    console.warn('Failed to group tree nodes by IfcRelContainedInSpatialStructure', err)
  }

  if (!ENABLE_ROOM_NUMBER_GROUPING) {
    return
  }

  try {
    const roomNumbers = await buildRoomNumberMap(viewer, nextTree, modelID, activeIfcText)
    if (!isCurrentTreeLoad(loadToken, isLoadTokenCurrent)) return

    setRoomNumbers(roomNumbers)
    nextTree = updateIfcTreeIfChanged({
      currentTree: nextTree,
      nextTree: groupIfcTreeByRoomNumber(nextTree, roomNumbers),
      modelID,
      setIfcTree
    })
  } catch (err) {
    console.warn('Failed to group storey nodes by room number', err)
  }
}
