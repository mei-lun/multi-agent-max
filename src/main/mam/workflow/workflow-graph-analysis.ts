import type { ArtifactRef } from '../../../shared/mam/domain/artifact'
import type { WorkflowDefinition, WorkflowNode } from '../../../shared/mam/domain/workflow'
import { WorkflowCompilationError } from './workflow-compilation-error'

export type WorkflowGraph = Readonly<{
  incoming: Map<string, Set<string>>
  outgoing: Map<string, Set<string>>
}>

export type WorkflowGraphs = Readonly<{
  complete: WorkflowGraph
  base: WorkflowGraph
}>

export function buildWorkflowGraphs(definition: WorkflowDefinition): WorkflowGraphs {
  return {
    complete: buildGraph(definition, false),
    base: buildGraph(definition, true)
  }
}

export function validateWorkflowPlan(
  definition: WorkflowDefinition,
  inputArtifacts: readonly ArtifactRef[],
  graphs: WorkflowGraphs
): string[] {
  validateConnectivity(definition, graphs)
  validateControlReferences(definition, graphs.complete)
  validateArtifactInputs(definition, inputArtifacts, graphs.base)
  const order = topologicalOrder(graphs.base)
  const ordinal = new Map(order.map((id, index) => [id, index]))
  const invalidLoop = definition.edges.find(
    (edge) =>
      edge.maxTraversals !== undefined &&
      (ordinal.get(edge.to) ?? Number.MAX_SAFE_INTEGER) > (ordinal.get(edge.from) ?? -1)
  )
  if (invalidLoop) {
    throw new WorkflowCompilationError(
      'invalid_loop_edge',
      `bounded edge must return to an earlier node: ${invalidLoop.from} -> ${invalidLoop.to}`
    )
  }
  return order
}

export function requiredArtifactRefs(node: WorkflowNode): ArtifactRef[] {
  return 'inputs' in node ? [...node.inputs] : []
}

export function producedArtifactTypes(node: WorkflowNode): string[] {
  if (node.type === 'role_task' || node.type === 'artifact_transform' || node.type === 'command') {
    return node.outputs.map((contract) => contract.artifactType)
  }
  if (node.type === 'review_gate') return [node.reportContract.artifactType]
  if (node.type === 'dynamic_tasks') return [node.planContract.artifactType]
  return []
}

function buildGraph(definition: WorkflowDefinition, omitBoundedEdges: boolean): WorkflowGraph {
  const incoming = new Map(definition.nodes.map((node) => [node.id, new Set<string>()]))
  const outgoing = new Map(definition.nodes.map((node) => [node.id, new Set<string>()]))
  for (const edge of definition.edges) {
    if (omitBoundedEdges && edge.maxTraversals !== undefined) continue
    incoming.get(edge.to)?.add(edge.from)
    outgoing.get(edge.from)?.add(edge.to)
  }
  return { incoming, outgoing }
}

function validateConnectivity(definition: WorkflowDefinition, graphs: WorkflowGraphs): void {
  const entries = definition.nodes.filter((node) => graphs.base.incoming.get(node.id)?.size === 0)
  if (entries.length !== 1) {
    throw new WorkflowCompilationError(
      'orphan_node',
      `workflow requires one base entry; found ${entries.map((node) => node.id).join(',')}`
    )
  }
  const reachable = walk(entries[0]!.id, graphs.complete.outgoing)
  const unreachable = definition.nodes.filter((node) => !reachable.has(node.id))
  if (unreachable.length > 0) {
    throw new WorkflowCompilationError(
      'orphan_node',
      `unreachable nodes: ${unreachable.map((node) => node.id).join(',')}`
    )
  }
  const canReachFinish = new Set<string>()
  for (const finish of definition.nodes.filter((node) => node.type === 'finish')) {
    for (const ancestor of walk(finish.id, graphs.complete.incoming)) canReachFinish.add(ancestor)
  }
  const deadEnds = definition.nodes.filter((node) => !canReachFinish.has(node.id))
  if (deadEnds.length > 0) {
    throw new WorkflowCompilationError(
      'orphan_node',
      `nodes cannot reach finish: ${deadEnds.map((node) => node.id).join(',')}`
    )
  }
}

function validateControlReferences(definition: WorkflowDefinition, graph: WorkflowGraph): void {
  for (const node of definition.nodes) {
    if (node.type === 'condition') {
      assertReferences(node.id, Object.values(node.branches), graph.outgoing, 'condition_branch')
    } else if (node.type === 'parallel') {
      assertReferences(node.id, node.branches, graph.outgoing, 'parallel_branch')
    } else if (node.type === 'join') {
      assertReferences(node.id, node.waitFor, graph.incoming, 'join_dependency')
    }
  }
}

function assertReferences(
  nodeId: string,
  references: readonly string[],
  adjacency: Map<string, Set<string>>,
  code: string
): void {
  const actual = adjacency.get(nodeId) ?? new Set()
  const invalid = references.find((reference) => !actual.has(reference))
  if (invalid) {
    throw new WorkflowCompilationError(code, `${nodeId} references non-edge node ${invalid}`)
  }
}

function validateArtifactInputs(
  definition: WorkflowDefinition,
  initialArtifacts: readonly ArtifactRef[],
  graph: WorkflowGraph
): void {
  const nodesById = new Map(definition.nodes.map((node) => [node.id, node]))
  const initialKeys = new Set(initialArtifacts.map(artifactKey))
  for (const node of definition.nodes) {
    const ancestors = walk(node.id, graph.incoming)
    ancestors.delete(node.id)
    for (const input of requiredArtifactRefs(node)) {
      const supplied = initialKeys.has(artifactKey(input))
      const produced = [...ancestors].some((id) => {
        const ancestor = nodesById.get(id)
        return ancestor && producedArtifactTypes(ancestor).includes(input.artifactId)
      })
      if (!supplied && !produced) {
        throw new WorkflowCompilationError(
          'unsatisfied_artifact_input',
          `${node.id} requires unavailable artifact ${input.artifactId}`
        )
      }
    }
  }
}

function topologicalOrder(graph: WorkflowGraph): string[] {
  const indegree = new Map([...graph.incoming].map(([id, sources]) => [id, sources.size]))
  const ready = [...indegree]
    .filter(([, count]) => count === 0)
    .map(([id]) => id)
    .sort()
  const ordered: string[] = []
  while (ready.length > 0) {
    const current = ready.shift()!
    ordered.push(current)
    for (const next of [...(graph.outgoing.get(current) ?? [])].sort()) {
      const remaining = (indegree.get(next) ?? 0) - 1
      indegree.set(next, remaining)
      if (remaining === 0) ready.push(next)
      ready.sort()
    }
  }
  return ordered
}

function walk(start: string, adjacency: Map<string, Set<string>>): Set<string> {
  const visited = new Set<string>()
  const pending = [start]
  while (pending.length > 0) {
    const current = pending.pop()!
    if (visited.has(current)) continue
    visited.add(current)
    pending.push(...(adjacency.get(current) ?? []))
  }
  return visited
}

function artifactKey(artifact: ArtifactRef): string {
  return `${artifact.artifactId}:${artifact.version}:${artifact.contentHash}`
}
