import type { ArtifactRef } from '../../../../shared/mam/domain/artifact'
import type { WorkflowDefinition, WorkflowNode } from '../../../../shared/mam/domain/workflow'
import { analyzeWorkflowVisual } from './mam-workflow-visual-analysis'

export type WorkflowArtifactRelation = Readonly<{
  id: string
  artifactId: string
  targetId: string
  sourceId?: string
  candidateIds: readonly string[]
  status: 'possible' | 'ambiguous' | 'initial' | 'missing'
  input: ArtifactRef
}>

export function workflowArtifactRelations(
  definition: WorkflowDefinition,
  initialArtifacts: readonly ArtifactRef[] = []
): WorkflowArtifactRelation[] {
  const { baseOutgoing } = analyzeWorkflowVisual(definition)
  const incoming = new Map(definition.nodes.map((node) => [node.id, [] as string[]]))
  for (const [from, targets] of baseOutgoing) {
    for (const to of targets) incoming.get(to)?.push(from)
  }
  const producers = definition.nodes.map((node) => ({ id: node.id, types: producedTypes(node) }))
  return definition.nodes.flatMap((node) =>
    ('inputs' in node ? node.inputs : []).map((input, index) => {
      const ancestors = upstream(node.id, incoming)
      const candidateIds = producers
        .filter(
          (producer) => ancestors.has(producer.id) && producer.types.includes(input.artifactId)
        )
        .map((producer) => producer.id)
        .sort()
      const initial = initialArtifacts.some((artifact) => sameArtifact(artifact, input))
      const status =
        initial && candidateIds.length > 0
          ? 'ambiguous'
          : initial
            ? 'initial'
            : candidateIds.length === 1
              ? 'possible'
              : candidateIds.length > 1
                ? 'ambiguous'
                : 'missing'
      return {
        id: `artifact:${node.id}:${input.artifactId}:${index}`,
        artifactId: input.artifactId,
        targetId: node.id,
        ...(status === 'possible' ? { sourceId: candidateIds[0] } : {}),
        candidateIds,
        status,
        input
      }
    })
  )
}

function producedTypes(node: WorkflowNode): readonly string[] {
  if (node.type === 'role_task' || node.type === 'artifact_transform' || node.type === 'command') {
    return node.outputs.map((output) => output.artifactType)
  }
  if (node.type === 'dynamic_tasks') return [node.planContract.artifactType]
  if (node.type === 'review_gate') return [node.reportContract.artifactType]
  return []
}

function upstream(start: string, incoming: ReadonlyMap<string, readonly string[]>): Set<string> {
  const seen = new Set<string>()
  const pending = [...(incoming.get(start) ?? [])]
  while (pending.length > 0) {
    const id = pending.pop()!
    if (seen.has(id)) continue
    seen.add(id)
    pending.push(...(incoming.get(id) ?? []))
  }
  return seen
}

function sameArtifact(left: ArtifactRef, right: ArtifactRef): boolean {
  return (
    left.artifactId === right.artifactId &&
    left.version === right.version &&
    left.contentHash === right.contentHash
  )
}
