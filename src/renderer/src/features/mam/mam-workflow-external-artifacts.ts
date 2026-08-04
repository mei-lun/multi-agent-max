import type { ArtifactRef } from '../../../../shared/mam/domain/artifact'
import type { WorkflowDefinition, WorkflowNode } from '../../../../shared/mam/domain/workflow'

export function workflowExternalArtifactRefs(workflow: WorkflowDefinition): readonly ArtifactRef[] {
  const incoming = new Map(workflow.nodes.map((node) => [node.id, new Set<string>()]))
  for (const edge of workflow.edges) {
    if (edge.maxTraversals === undefined) incoming.get(edge.to)?.add(edge.from)
  }
  const nodesById = new Map(workflow.nodes.map((node) => [node.id, node]))
  const external = new Map<string, ArtifactRef>()
  for (const node of workflow.nodes) {
    if (!('inputs' in node)) continue
    const ancestors = ancestorNodeIds(node.id, incoming)
    for (const input of node.inputs) {
      const producedUpstream = [...ancestors].some((nodeId) => {
        const ancestor = nodesById.get(nodeId)
        return ancestor && producedArtifactTypes(ancestor).includes(input.artifactId)
      })
      if (!producedUpstream) external.set(artifactKey(input), input)
    }
  }
  return [...external.values()].sort((left, right) =>
    artifactKey(left).localeCompare(artifactKey(right))
  )
}

function ancestorNodeIds(nodeId: string, incoming: ReadonlyMap<string, ReadonlySet<string>>) {
  const ancestors = new Set<string>()
  const pending = [...(incoming.get(nodeId) ?? [])]
  while (pending.length > 0) {
    const current = pending.pop()!
    if (ancestors.has(current)) continue
    ancestors.add(current)
    pending.push(...(incoming.get(current) ?? []))
  }
  return ancestors
}

function producedArtifactTypes(node: WorkflowNode): readonly string[] {
  if (node.type === 'role_task' || node.type === 'artifact_transform' || node.type === 'command') {
    return node.outputs.map((contract) => contract.artifactType)
  }
  if (node.type === 'review_gate') return [node.reportContract.artifactType]
  if (node.type === 'dynamic_tasks') return [node.planContract.artifactType]
  return []
}

function artifactKey(artifact: ArtifactRef): string {
  return `${artifact.artifactId}:${artifact.version}:${artifact.contentHash}`
}
