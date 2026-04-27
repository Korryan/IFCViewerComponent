import { useCallback, useRef, useState } from 'react'
import type { ObjectTree } from '../ifcViewerTypes'
import { removeTreeNodeSubtree, upsertCustomTreeNode } from './objectTree.customNodes'
export { buildIfcTree } from './objectTree.spatial'
export { groupIfcTreeByRoomNumber, groupIfcTreeBySpatialContainment } from './objectTree.grouping'

const emptyTree: ObjectTree = { nodes: {}, roots: [] }

// Hook that owns the tree state; UI can subscribe later
export const useObjectTree = () => {
  const [tree, setTree] = useState<ObjectTree>(emptyTree)
  const customIdCounterRef = useRef(1)

  // This replaces the current IFC tree snapshot after a model load or tree regrouping step.
  const setIfcTree = useCallback((next: ObjectTree, _modelID: number) => {
    setTree(next)
  }, [])

  // This clears all IFC and custom nodes so the next model starts from an empty tree.
  const resetTree = useCallback(() => setTree(emptyTree), [])

  // This inserts or updates one custom node while keeping parent-child links consistent.
  const addCustomNode = useCallback(
    (payload: {
      modelID: number
      expressID?: number | null
      label: string
      type?: string
      parentId?: string | null
    }) => {
      let nextNodeId = ''
      setTree((prev) => {
        const result = upsertCustomTreeNode({
          tree: prev,
          payload,
          counter: customIdCounterRef.current
        })
        nextNodeId = result.nodeId
        customIdCounterRef.current = result.nextCounter
        return result.nextTree
      })

      return nextNodeId
    },
    []
  )

  // This removes one node and every descendant node so custom tree deletes stay structurally valid.
  const removeNode = useCallback((nodeId: string) => {
    setTree((prev) => removeTreeNodeSubtree(prev, nodeId))
  }, [])

  return { tree, setIfcTree, resetTree, addCustomNode, removeNode }
}
