import { useEffect } from 'react'
import type { Dispatch, MutableRefObject, SetStateAction } from 'react'
import type { FurnitureItem, ObjectTree, Point3D } from './ifcViewerTypes'
import type { IfcViewerAPI } from './viewer/IfcViewerAPICompat'
import { CUSTOM_CUBE_MODEL_ID } from './hooks/selectionOffsets.shared'
import { parseCubeId } from './ifcViewer.utils'
import { collectMaterializedFurnitureItemIds } from './ifcViewer.furnitureReconciliation'

type SetState<T> = Dispatch<SetStateAction<T>>

type UseIfcViewerFurnitureRestorationArgs = {
  ensureViewer: () => IfcViewerAPI | null
  activeModelId: number | null
  isHydrated: boolean
  isFurnitureStateReconciled: boolean
  tree: ObjectTree
  furnitureEntries: FurnitureItem[]
  setFurnitureEntries: SetState<FurnitureItem[]>
  setIsFurnitureStateReconciled: (value: boolean) => void
  furnitureRestoredRef: MutableRefObject<boolean>
  addCustomNode: (payload: {
    modelID: number
    expressID?: number | null
    label: string
    type?: string
    parentId?: string | null
  }) => string
  removeNode: (nodeId: string) => void
  findCustomObjectExpressIdByItemId: (itemId: string | null | undefined) => number | null
  removeCustomCube: (expressID: number) => void
  spawnCube: (target?: Point3D | null, options?: { focus?: boolean; id?: number }) => {
    expressID: number
    position: Point3D
  } | null
  spawnStoredCustomObject: (args: {
    itemId: string
    model: string
    name?: string | null
    position: Point3D
    rotation?: Point3D | null
    geometry: NonNullable<FurnitureItem['geometry']>
    roomNumber?: string | null
    spaceIfcId?: number | null
    sourceFileName?: string | null
    focus?: boolean
  }) => { expressID: number; position: Point3D } | null
  setCustomCubeRoomNumber: (expressID: number, roomNumber?: string | null) => void
  setCustomObjectSpaceIfcId: (expressID: number, spaceIfcId?: number | null) => void
  ensureCustomCubesPickable: () => void
  findSpaceNodeIdByIfcId: (ifcId?: number | null) => string | null
  findSpaceNodeIdByRoomNumber: (roomNumber?: string | null) => string | null
}

// Reconciles materialized IFC furniture and restores persisted custom objects after a model load.
export const useIfcViewerFurnitureRestoration = ({
  ensureViewer,
  activeModelId,
  isHydrated,
  isFurnitureStateReconciled,
  tree,
  furnitureEntries,
  setFurnitureEntries,
  setIsFurnitureStateReconciled,
  furnitureRestoredRef,
  addCustomNode,
  removeNode,
  findCustomObjectExpressIdByItemId,
  removeCustomCube,
  spawnCube,
  spawnStoredCustomObject,
  setCustomCubeRoomNumber,
  setCustomObjectSpaceIfcId,
  ensureCustomCubesPickable,
  findSpaceNodeIdByIfcId,
  findSpaceNodeIdByRoomNumber
}: UseIfcViewerFurnitureRestorationArgs) => {
  // This effect reconciles exported furniture entries against real IFC furnishing elements after load.
  useEffect(() => {
    if (!isHydrated || activeModelId === null || tree.roots.length === 0) return

    const viewer = ensureViewer()
    if (!viewer) {
      setIsFurnitureStateReconciled(true)
      return
    }

    let cancelled = false
    void (async () => {
      const materializedItemIds = await collectMaterializedFurnitureItemIds({
        viewer,
        tree,
        modelID: activeModelId,
        furnitureEntries
      })
      if (cancelled) return

      if (materializedItemIds.size > 0) {
        const customExpressIds = furnitureEntries
          .map((item) => {
            if (!materializedItemIds.has(item.id)) return null
            return item.model === 'cube'
              ? parseCubeId(item.id)
              : findCustomObjectExpressIdByItemId(item.id)
          })
          .filter((expressID): expressID is number => typeof expressID === 'number')

        customExpressIds.forEach((expressID) => {
          removeCustomCube(expressID)
          const customNode = Object.values(tree.nodes).find(
            (node) =>
              node.nodeType === 'custom' &&
              node.modelID === CUSTOM_CUBE_MODEL_ID &&
              node.expressID === expressID
          )
          if (customNode) {
            removeNode(customNode.id)
          }
        })

        setFurnitureEntries((prev) => prev.filter((item) => !materializedItemIds.has(item.id)))
      }

      setIsFurnitureStateReconciled(true)
    })()

    return () => {
      cancelled = true
    }
  }, [
    activeModelId,
    ensureViewer,
    findCustomObjectExpressIdByItemId,
    furnitureEntries,
    isHydrated,
    removeCustomCube,
    removeNode,
    setFurnitureEntries,
    setIsFurnitureStateReconciled,
    tree
  ])

  // This effect restores saved custom furniture into the scene after the IFC tree becomes available.
  useEffect(() => {
    if (!isHydrated || furnitureRestoredRef.current || activeModelId === null || tree.roots.length === 0) return
    if (!isFurnitureStateReconciled) return
    const viewer = ensureViewer()
    if (!viewer) return
    furnitureEntries.forEach((item) => {
      let info: { expressID: number; position: Point3D } | null = null
      if (item.model === 'cube') {
        const cubeId = parseCubeId(item.id)
        if (!cubeId) return
        info = spawnCube(item.position, { id: cubeId, focus: false })
      } else if (item.geometry) {
        info = spawnStoredCustomObject({
          itemId: item.id,
          model: item.model,
          name: item.name,
          position: item.position,
          rotation: item.rotation,
          geometry: item.geometry,
          roomNumber: item.roomNumber,
          spaceIfcId: item.spaceIfcId,
          sourceFileName: item.custom?.sourceFileName ?? null,
          focus: false
        })
      }
      if (!info) return
      setCustomCubeRoomNumber(info.expressID, item.roomNumber)
      setCustomObjectSpaceIfcId(info.expressID, item.spaceIfcId)
      const parentId = findSpaceNodeIdByIfcId(item.spaceIfcId) ?? findSpaceNodeIdByRoomNumber(item.roomNumber)
      addCustomNode({
        modelID: CUSTOM_CUBE_MODEL_ID,
        expressID: info.expressID,
        label: item.model === 'cube' ? `Cube #${info.expressID}` : item.name ?? item.id,
        type: item.model === 'cube' ? 'CUBE' : 'FURNITURE',
        parentId
      })
    })
    furnitureRestoredRef.current = true
  }, [
    activeModelId,
    addCustomNode,
    ensureViewer,
    findSpaceNodeIdByIfcId,
    findSpaceNodeIdByRoomNumber,
    furnitureEntries,
    furnitureRestoredRef,
    isFurnitureStateReconciled,
    isHydrated,
    setCustomCubeRoomNumber,
    setCustomObjectSpaceIfcId,
    spawnCube,
    spawnStoredCustomObject,
    tree.roots.length
  ])

  // This effect re-registers restored custom objects as pickable once a model is active.
  useEffect(() => {
    if (activeModelId === null) return
    ensureCustomCubesPickable()
  }, [activeModelId, ensureCustomCubesPickable])

  // This effect creates any missing custom tree nodes after custom objects have been restored.
  useEffect(() => {
    if (!isHydrated || !isFurnitureStateReconciled || tree.roots.length === 0) return
    const existing = new Set<number>()
    Object.values(tree.nodes).forEach((node) => {
      if (node.nodeType === 'custom' && node.modelID === CUSTOM_CUBE_MODEL_ID && node.expressID !== null) {
        existing.add(node.expressID)
      }
    })
    furnitureEntries.forEach((item) => {
      let expressID: number | null = null
      if (item.model === 'cube') {
        const cubeId = parseCubeId(item.id)
        if (!cubeId) return
        expressID = cubeId
      } else {
        expressID = findCustomObjectExpressIdByItemId(item.id)
      }
      if (!expressID || existing.has(expressID)) return
      const parentId = findSpaceNodeIdByIfcId(item.spaceIfcId) ?? findSpaceNodeIdByRoomNumber(item.roomNumber)
      addCustomNode({
        modelID: CUSTOM_CUBE_MODEL_ID,
        expressID,
        label: item.model === 'cube' ? `Cube #${expressID}` : item.name ?? item.id,
        type: item.model === 'cube' ? 'CUBE' : 'FURNITURE',
        parentId
      })
    })
  }, [
    addCustomNode,
    findCustomObjectExpressIdByItemId,
    findSpaceNodeIdByIfcId,
    findSpaceNodeIdByRoomNumber,
    furnitureEntries,
    isFurnitureStateReconciled,
    isHydrated,
    tree.nodes,
    tree.roots
  ])
}
