import type { FragmentsModel } from '@thatopen/fragments'
import type { BufferGeometry, Color, Material, Mesh } from 'three'

// Describes the supported viewer constructor options for the compatibility wrapper.
export type ViewerOptions = {
  container: HTMLElement
  backgroundColor?: Color
}

// Describes one IFC mesh instance tracked by the compatibility wrapper.
export type IfcModelLike = Mesh & {
  modelID?: number
  __modelKey?: string
  removeFromParent?: () => void
}

// Describes one cached geometry slice and its resolved render material.
export type GeometrySlice = {
  geometry: BufferGeometry
  material: Material | Material[]
}

// Describes one cached subset selection mesh and its tracked express ids.
export type SubsetRecord = {
  ids: Set<number>
  mesh: Mesh
}

// Describes one fully loaded IFC model record stored by the compatibility wrapper.
export type ModelRecord = {
  numericId: number
  modelKey: string
  mesh: IfcModelLike
  fragments: FragmentsModel
  expressIds: Set<number>
  geometryCache: Map<number, GeometrySlice[]>
  subsets: Map<string, SubsetRecord>
  ifcTypeCache: Map<number, string>
}
