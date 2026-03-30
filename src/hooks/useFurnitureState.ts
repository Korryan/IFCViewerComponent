import { useCallback, useEffect, useRef, useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import type { FurnitureGeometry, FurnitureItem, Point3D } from '../ifcViewerTypes'
import { CUBE_ITEM_PREFIX } from '../ifcViewer.constants'
import { buildUploadedFurnitureId, buildUploadedFurnitureName } from '../ifcViewer.utils'

type UploadedFurnitureInfo = {
  expressID: number
  position: Point3D
  geometry?: FurnitureGeometry | null
} | null

type UseFurnitureStateArgs = {
  furniture?: FurnitureItem[]
  isHydrated: boolean
  onFurnitureChange?: (items: FurnitureItem[]) => void
  setCustomCubeRoomNumber: (expressID: number, roomNumber?: string | null) => void
  setCustomObjectSpaceIfcId: (expressID: number, spaceIfcId?: number | null) => void
  setCustomObjectItemId: (expressID: number, itemId?: string | null) => void
  buildFurnitureCustom?: (args?: {
    position?: Point3D | null
    spaceIfcId?: number | null
    extraCustom?: Record<string, string>
  }) => Promise<Record<string, string> | undefined>
}

type UseFurnitureStateResult = {
  furnitureEntries: FurnitureItem[]
  setFurnitureEntries: Dispatch<SetStateAction<FurnitureItem[]>>
  suppressNextFurnitureNotify: () => void
  upsertFurnitureItem: (nextItem: FurnitureItem) => void
  registerCubeFurniture: (
    info: { expressID: number; position: Point3D },
    roomNumber?: string | null,
    spaceIfcId?: number | null
  ) => Promise<void>
  registerUploadedFurniture: (
    file: File,
    info: UploadedFurnitureInfo,
    roomNumber?: string | null,
    spaceIfcId?: number | null
  ) => Promise<string | null>
}

export const useFurnitureState = ({
  furniture,
  isHydrated,
  onFurnitureChange,
  setCustomCubeRoomNumber,
  setCustomObjectSpaceIfcId,
  setCustomObjectItemId,
  buildFurnitureCustom
}: UseFurnitureStateArgs): UseFurnitureStateResult => {
  const [furnitureEntries, setFurnitureEntries] = useState<FurnitureItem[]>([])
  const suppressFurnitureNotifyRef = useRef(false)

  const suppressNextFurnitureNotify = useCallback(() => {
    suppressFurnitureNotifyRef.current = true
  }, [])

  const upsertFurnitureItem = useCallback((nextItem: FurnitureItem) => {
    setFurnitureEntries((prev) => {
      const index = prev.findIndex((item) => item.id === nextItem.id)
      if (index === -1) {
        return [...prev, nextItem]
      }
      const next = prev.slice()
      next[index] = {
        ...prev[index],
        ...nextItem,
        name: nextItem.name ?? prev[index].name,
        position: nextItem.position,
        rotation: nextItem.rotation ?? prev[index].rotation,
        scale: nextItem.scale ?? prev[index].scale,
        roomNumber: nextItem.roomNumber ?? prev[index].roomNumber,
        spaceIfcId: nextItem.spaceIfcId ?? prev[index].spaceIfcId,
        custom: nextItem.custom
          ? {
              ...(prev[index].custom ?? {}),
              ...nextItem.custom
            }
          : prev[index].custom,
        geometry: nextItem.geometry ?? prev[index].geometry
      }
      return next
    })
  }, [])

  const registerCubeFurniture = useCallback(
    async (
      info: { expressID: number; position: Point3D },
      roomNumber?: string | null,
      spaceIfcId?: number | null
    ) => {
      const custom = await buildFurnitureCustom?.({
        position: info.position,
        spaceIfcId: spaceIfcId ?? undefined
      })
      setCustomCubeRoomNumber(info.expressID, roomNumber)
      setCustomObjectSpaceIfcId(info.expressID, spaceIfcId)
      upsertFurnitureItem({
        id: `${CUBE_ITEM_PREFIX}${info.expressID}`,
        model: 'cube',
        name: `Cube #${info.expressID}`,
        position: info.position,
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
        roomNumber: roomNumber ?? undefined,
        spaceIfcId: spaceIfcId ?? undefined,
        custom
      })
      setCustomObjectSpaceIfcId(info.expressID, spaceIfcId)
      setCustomObjectItemId(info.expressID, `${CUBE_ITEM_PREFIX}${info.expressID}`)
    },
    [
      buildFurnitureCustom,
      setCustomCubeRoomNumber,
      setCustomObjectItemId,
      setCustomObjectSpaceIfcId,
      upsertFurnitureItem
    ]
  )

  const registerUploadedFurniture = useCallback(
    async (
      file: File,
      info: UploadedFurnitureInfo,
      roomNumber?: string | null,
      spaceIfcId?: number | null
    ) => {
      if (!info) return null
      const itemId = buildUploadedFurnitureId(file.name)
      const custom = await buildFurnitureCustom?.({
        position: info.position,
        spaceIfcId: spaceIfcId ?? undefined,
        extraCustom: {
          sourceFileName: file.name
        }
      })
      upsertFurnitureItem({
        id: itemId,
        model: 'uploaded-ifc',
        name: buildUploadedFurnitureName(file.name),
        position: info.position,
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
        roomNumber: roomNumber ?? undefined,
        spaceIfcId: spaceIfcId ?? undefined,
        geometry: info.geometry ?? undefined,
        custom
      })
      setCustomCubeRoomNumber(info.expressID, roomNumber)
      setCustomObjectSpaceIfcId(info.expressID, spaceIfcId)
      setCustomObjectItemId(info.expressID, itemId)
      return itemId
    },
    [
      buildFurnitureCustom,
      setCustomCubeRoomNumber,
      setCustomObjectItemId,
      setCustomObjectSpaceIfcId,
      upsertFurnitureItem
    ]
  )

  useEffect(() => {
    if (furniture === undefined) return
    const incomingFurniture = Array.isArray(furniture) ? furniture : []
    setFurnitureEntries((prev) => {
      if (prev === incomingFurniture) return prev
      suppressFurnitureNotifyRef.current = true
      return incomingFurniture
    })
  }, [furniture])

  useEffect(() => {
    if (!isHydrated || !onFurnitureChange) return
    if (suppressFurnitureNotifyRef.current) {
      suppressFurnitureNotifyRef.current = false
      return
    }
    onFurnitureChange(furnitureEntries)
  }, [furnitureEntries, isHydrated, onFurnitureChange])

  return {
    furnitureEntries,
    setFurnitureEntries,
    suppressNextFurnitureNotify,
    upsertFurnitureItem,
    registerCubeFurniture,
    registerUploadedFurniture
  }
}
