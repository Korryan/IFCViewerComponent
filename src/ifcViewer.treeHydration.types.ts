import type { ObjectTree } from './ifcViewerTypes'
import type { StoreyInfo } from './ifcRoomTree.utils'
import type { IfcViewerAPI } from './viewer/IfcViewerAPICompat'

// Describes the state setters owned by the viewer component during tree rebuild.
export type TreeRebuildStateHandlers = {
  setIfcTree: (tree: ObjectTree, modelID: number) => void
  resetTree: () => void
  setSelectedNodeId: (nodeId: string | null) => void
  setStoreyInfoByNodeId: (value: Record<string, StoreyInfo>) => void
  setRoomNumbers: (value: Map<number, string>) => void
}

// Describes the shared async context for one in-flight tree hydration task.
export type TreeHydrationTaskArgs = {
  viewer: IfcViewerAPI
  modelID: number
  loadToken: number
  isLoadTokenCurrent: (token: number) => boolean
}

// Describes the arguments needed by the asynchronous enrichment pipeline after the raw tree is built.
export type TreeEnrichmentArgs = TreeHydrationTaskArgs & {
  tree: ObjectTree
  activeIfcText: string | null
  setIfcTree: (tree: ObjectTree, modelID: number) => void
  setStoreyInfoByNodeId: (value: Record<string, StoreyInfo>) => void
  setRoomNumbers: (value: Map<number, string>) => void
}

// Describes the full arguments accepted by the public tree rebuild entry point.
export type TreeRebuildArgs = TreeHydrationTaskArgs &
  TreeRebuildStateHandlers & {
    activeIfcText: string | null
  }
