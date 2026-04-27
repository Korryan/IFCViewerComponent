import {
  parseIfcReferenceId,
  resolveIfcEntityKind
} from './ifcViewer.ifcValues'

// Collects the relation payloads that may describe spatial containment for one IFC element.
const collectContainmentRelations = (properties: any): unknown[] => {
  const relationCandidates = [
    properties?.ContainedInStructure,
    properties?.containedInStructure,
    properties?.IsContainedIn,
    properties?.isContainedIn
  ]
  const relations: unknown[] = []
  relationCandidates.forEach((candidate) => {
    if (candidate === undefined || candidate === null) return
    if (Array.isArray(candidate)) {
      relations.push(...candidate)
    } else {
      relations.push(candidate)
    }
  })
  return relations
}

// Resolves the IFC space id pointed to by one containment relation payload.
export const resolveContainedSpaceIdFromRelation = (relation: unknown): number | null => {
  if (!relation || typeof relation !== 'object') return null
  const relationObj = relation as Record<string, unknown>
  const relationType = resolveIfcEntityKind(relationObj)
  if (relationType && relationType !== 'IFCRELCONTAINEDINSPATIALSTRUCTURE') return null
  const spaceCandidate =
    relationObj.RelatingStructure ??
    relationObj.relatingStructure ??
    relationObj.RelatedStructure ??
    relationObj.relatedStructure
  return parseIfcReferenceId(spaceCandidate)
}

// Resolves the first IFC space id referenced by the containment relations of one IFC properties object.
export const resolveContainedSpaceId = (properties: any): number | null => {
  const relations = collectContainmentRelations(properties)
  for (const relation of relations) {
    const spaceId = resolveContainedSpaceIdFromRelation(relation)
    if (spaceId !== null) return spaceId
  }
  return null
}

// Collects all containment relation express ids referenced by one IFC properties object.
export const collectContainedRelationIds = (properties: any): number[] => {
  const relations = collectContainmentRelations(properties)
  const relationIds: number[] = []
  for (const relation of relations) {
    const relationId = parseIfcReferenceId(relation)
    if (relationId !== null) {
      relationIds.push(relationId)
    }
  }
  return relationIds
}
