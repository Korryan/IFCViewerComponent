import { useMemo, useRef } from 'react'
import type { MutableRefObject } from 'react'
import { Matrix4, Mesh, MeshStandardMaterial } from 'three'
import type { OffsetVector, Point3D } from '../ifcViewerTypes'
import type { CustomObjectRegistryRefs } from './selectionOffsets.customRegistry'

// Describes the full mutable ref bundle used by the selection-offset runtime.
export type SelectionOffsetRefs = {
  propertyRequestRef: MutableRefObject<number>
  baseSubsetsRef: MutableRefObject<Map<number, Mesh>>
  movedSubsetsRef: MutableRefObject<Map<string, Mesh>>
  spaceBiasSubsetsRef: MutableRefObject<Map<number, Mesh>>
  spaceBiasIdsRef: MutableRefObject<Map<number, Set<number>>>
  spaceBiasAppliedRef: MutableRefObject<Map<number, Set<number>>>
  hiddenIdsRef: MutableRefObject<Map<number, Set<number>>>
  elementOffsetsRef: MutableRefObject<Map<string, OffsetVector>>
  elementRotationsRef: MutableRefObject<Map<string, Point3D>>
  expressIdCacheRef: MutableRefObject<Map<number, Set<number>>>
  baseCentersRef: MutableRefObject<Map<string, Point3D>>
  placementOriginsRef: MutableRefObject<Map<string, Point3D>>
  coordinationMatrixRef: MutableRefObject<Map<number, Matrix4 | null>>
  filterSubsetsRef: MutableRefObject<Map<number, Mesh>>
  filterIdsRef: MutableRefObject<Map<number, Set<number> | null>>
  cubeRegistryRef: MutableRefObject<Map<number, Mesh>>
  cubeIdCounterRef: MutableRefObject<number>
  highlightedCubeRef: MutableRefObject<number | null>
  highlightedIfcRef: MutableRefObject<{ modelID: number; expressID: number } | null>
  selectionSubsetsRef: MutableRefObject<Map<number, Mesh>>
  selectionMaterialRef: MutableRefObject<MeshStandardMaterial | null>
  focusOffsetRef: MutableRefObject<Point3D | null>
  customCubeRoomsRef: MutableRefObject<Map<number, string>>
  customObjectSpaceIfcIdsRef: MutableRefObject<Map<number, number>>
  customObjectModelsRef: MutableRefObject<Map<number, string>>
  customObjectNamesRef: MutableRefObject<Map<number, string>>
  customObjectItemIdsRef: MutableRefObject<Map<number, string>>
  customObjectSourceFilesRef: MutableRefObject<Map<number, string>>
  customObjectRegistryRefs: CustomObjectRegistryRefs
}

// Builds the stable custom-object registry facade shared across cube and prefab helpers.
const buildCustomObjectRegistryRefs = (args: {
  cubeRegistryRef: MutableRefObject<Map<number, Mesh>>
  cubeIdCounterRef: MutableRefObject<number>
  highlightedCubeRef: MutableRefObject<number | null>
  customCubeRoomsRef: MutableRefObject<Map<number, string>>
  customObjectSpaceIfcIdsRef: MutableRefObject<Map<number, number>>
  customObjectModelsRef: MutableRefObject<Map<number, string>>
  customObjectNamesRef: MutableRefObject<Map<number, string>>
  customObjectItemIdsRef: MutableRefObject<Map<number, string>>
  customObjectSourceFilesRef: MutableRefObject<Map<number, string>>
}): CustomObjectRegistryRefs => {
  return {
    cubeRegistryRef: args.cubeRegistryRef,
    cubeIdCounterRef: args.cubeIdCounterRef,
    highlightedCubeRef: args.highlightedCubeRef,
    customCubeRoomsRef: args.customCubeRoomsRef,
    customObjectSpaceIfcIdsRef: args.customObjectSpaceIfcIdsRef,
    customObjectModelsRef: args.customObjectModelsRef,
    customObjectNamesRef: args.customObjectNamesRef,
    customObjectItemIdsRef: args.customObjectItemIdsRef,
    customObjectSourceFilesRef: args.customObjectSourceFilesRef
  }
}

// Builds every mutable cache ref used by the selection-offset hook in one place.
export const useSelectionOffsetRefs = (): SelectionOffsetRefs => {
  const propertyRequestRef = useRef(0)
  const baseSubsetsRef = useRef<Map<number, Mesh>>(new Map())
  const movedSubsetsRef = useRef<Map<string, Mesh>>(new Map())
  const spaceBiasSubsetsRef = useRef<Map<number, Mesh>>(new Map())
  const spaceBiasIdsRef = useRef<Map<number, Set<number>>>(new Map())
  const spaceBiasAppliedRef = useRef<Map<number, Set<number>>>(new Map())
  const hiddenIdsRef = useRef<Map<number, Set<number>>>(new Map())
  const elementOffsetsRef = useRef<Map<string, OffsetVector>>(new Map())
  const elementRotationsRef = useRef<Map<string, Point3D>>(new Map())
  const expressIdCacheRef = useRef<Map<number, Set<number>>>(new Map())
  const baseCentersRef = useRef<Map<string, Point3D>>(new Map())
  const placementOriginsRef = useRef<Map<string, Point3D>>(new Map())
  const coordinationMatrixRef = useRef<Map<number, Matrix4 | null>>(new Map())
  const filterSubsetsRef = useRef<Map<number, Mesh>>(new Map())
  const filterIdsRef = useRef<Map<number, Set<number> | null>>(new Map())
  const cubeRegistryRef = useRef<Map<number, Mesh>>(new Map())
  const cubeIdCounterRef = useRef(1)
  const highlightedCubeRef = useRef<number | null>(null)
  const highlightedIfcRef = useRef<{ modelID: number; expressID: number } | null>(null)
  const selectionSubsetsRef = useRef<Map<number, Mesh>>(new Map())
  const selectionMaterialRef = useRef<MeshStandardMaterial | null>(null)
  const focusOffsetRef = useRef<Point3D | null>(null)
  const customCubeRoomsRef = useRef<Map<number, string>>(new Map())
  const customObjectSpaceIfcIdsRef = useRef<Map<number, number>>(new Map())
  const customObjectModelsRef = useRef<Map<number, string>>(new Map())
  const customObjectNamesRef = useRef<Map<number, string>>(new Map())
  const customObjectItemIdsRef = useRef<Map<number, string>>(new Map())
  const customObjectSourceFilesRef = useRef<Map<number, string>>(new Map())

  const customObjectRegistryRefs = useMemo<CustomObjectRegistryRefs>(
    () =>
      buildCustomObjectRegistryRefs({
        cubeRegistryRef,
        cubeIdCounterRef,
        highlightedCubeRef,
        customCubeRoomsRef,
        customObjectSpaceIfcIdsRef,
        customObjectModelsRef,
        customObjectNamesRef,
        customObjectItemIdsRef,
        customObjectSourceFilesRef
      }),
    []
  )

  // This memoizes the ref bundle so downstream callbacks do not change identity on every render.
  return useMemo(
    () => ({
      propertyRequestRef,
      baseSubsetsRef,
      movedSubsetsRef,
      spaceBiasSubsetsRef,
      spaceBiasIdsRef,
      spaceBiasAppliedRef,
      hiddenIdsRef,
      elementOffsetsRef,
      elementRotationsRef,
      expressIdCacheRef,
      baseCentersRef,
      placementOriginsRef,
      coordinationMatrixRef,
      filterSubsetsRef,
      filterIdsRef,
      cubeRegistryRef,
      cubeIdCounterRef,
      highlightedCubeRef,
      highlightedIfcRef,
      selectionSubsetsRef,
      selectionMaterialRef,
      focusOffsetRef,
      customCubeRoomsRef,
      customObjectSpaceIfcIdsRef,
      customObjectModelsRef,
      customObjectNamesRef,
      customObjectItemIdsRef,
      customObjectSourceFilesRef,
      customObjectRegistryRefs
    }),
    [customObjectRegistryRefs]
  )
}
