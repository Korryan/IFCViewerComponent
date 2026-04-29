import { useMemo } from 'react'
import type { MetadataEntry } from './ifcViewerTypes'

type UseIfcViewerDerivedStateArgs = {
  file?: File | null
  defaultModelUrl?: string
  showTree: boolean
  showProperties: boolean
  metadataEntries: MetadataEntry[]
}

// Computes stable viewer-derived state used across tree, persistence, and load orchestration.
export const useIfcViewerDerivedState = ({
  file,
  defaultModelUrl,
  showTree,
  showProperties,
  metadataEntries
}: UseIfcViewerDerivedStateArgs) => {
  const metadataMap = useMemo(
    () => new Map(metadataEntries.map((entry) => [entry.ifcId, entry])),
    [metadataEntries]
  )
  const deletedIfcIds = useMemo(() => {
    const ids = new Set<number>()
    metadataEntries.forEach((entry) => {
      if (entry.deleted) {
        ids.add(entry.ifcId)
      }
    })
    return ids
  }, [metadataEntries])
  const showSidePanel = showTree || showProperties
  const sourceKey = useMemo(
    () =>
      file
        ? `file:${file.name}:${file.size}:${file.lastModified}`
        : defaultModelUrl
          ? `url:${defaultModelUrl}`
          : 'none',
    [defaultModelUrl, file]
  )

  return {
    metadataMap,
    deletedIfcIds,
    showSidePanel,
    sourceKey
  }
}
