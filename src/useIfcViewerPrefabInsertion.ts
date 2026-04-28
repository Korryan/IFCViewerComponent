import { useCallback, type Dispatch, type SetStateAction } from 'react'
import type { InsertPrefabOption } from './ifcViewerTypes'

type UseIfcViewerPrefabInsertionArgs = {
  prefabs: InsertPrefabOption[]
  onResolvePrefabFile?: (prefabId: string) => Promise<File | null>
  setStatus: Dispatch<SetStateAction<string | null>>
  setError: Dispatch<SetStateAction<string | null>>
  handleTreeInsertPrefab: (nodeId: string, file: File) => Promise<void>
  spawnPrefabAt: (file: File) => Promise<void>
}

// Resolves prefab files on demand and inserts them at the requested tree node or cursor target.
export const useIfcViewerPrefabInsertion = ({
  prefabs,
  onResolvePrefabFile,
  setStatus,
  setError,
  handleTreeInsertPrefab,
  spawnPrefabAt
}: UseIfcViewerPrefabInsertionArgs) => {
  // This resolves a prefab file and inserts it either at the requested node or at the current cursor target.
  const handleInsertPrefab = useCallback(
    async (prefabId: string, nodeId?: string | null) => {
      if (!onResolvePrefabFile) {
        setError('Prefab loading is not configured.')
        return
      }

      const prefab = prefabs.find((item) => item.prefabId === prefabId)
      try {
        setError(null)
        setStatus(prefab ? `Loading prefab ${prefab.fileName}...` : 'Loading prefab...')
        const prefabFile = await onResolvePrefabFile(prefabId)
        if (!prefabFile) {
          setStatus(null)
          setError('Failed to load prefab IFC file.')
          return
        }

        if (nodeId) {
          await handleTreeInsertPrefab(nodeId, prefabFile)
        } else {
          await spawnPrefabAt(prefabFile)
        }
        setStatus(null)
      } catch (err) {
        console.error('Failed to insert prefab', err)
        setStatus(null)
        setError('Failed to insert prefab IFC file.')
      }
    },
    [handleTreeInsertPrefab, onResolvePrefabFile, prefabs, setError, setStatus, spawnPrefabAt]
  )

  return { handleInsertPrefab }
}
