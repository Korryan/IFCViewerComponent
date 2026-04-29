import { useCallback, type MutableRefObject } from 'react'
import { loadIfcModelWithSettings } from './ifcViewer.loading'
import type { IfcViewerAPI } from './viewer/IfcViewerAPICompat'

// Builds the shared IFC loader that captures raw IFC text and the inverse coordination matrix for later editors.
export const useIfcViewerLoadSource = (
  activeIfcTextRef: MutableRefObject<string | null>,
  activeModelInverseCoordinationMatrixRef: MutableRefObject<number[] | null>
) => {
  return useCallback(
    async (viewer: IfcViewerAPI, source: { file?: File; url?: string }, fitToFrame: boolean) => {
      activeModelInverseCoordinationMatrixRef.current = null
      activeIfcTextRef.current = null
      const loaded = await loadIfcModelWithSettings({
        viewer,
        source,
        fitToFrame
      })
      activeIfcTextRef.current = loaded?.ifcText ?? null
      activeModelInverseCoordinationMatrixRef.current = loaded?.inverseCoordinationMatrix ?? null
      return loaded?.model ?? null
    },
    [activeIfcTextRef, activeModelInverseCoordinationMatrixRef]
  )
}
