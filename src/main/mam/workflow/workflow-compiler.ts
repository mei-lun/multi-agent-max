import { createHash } from 'node:crypto'
import { parse as parseYaml } from 'yaml'
import { ArtifactRefSchema, type ArtifactRef } from '../../../shared/mam/domain/artifact'
import {
  WorkflowDefinitionSchema,
  type WorkflowDefinition
} from '../../../shared/mam/domain/workflow'
import {
  WorkflowExecutionPlanSchema,
  type WorkflowExecutionPlan
} from '../../../shared/mam/domain/run-bundle'
import {
  buildWorkflowGraphs,
  producedArtifactTypes,
  requiredArtifactRefs,
  validateWorkflowPlan
} from './workflow-graph-analysis'
import { WorkflowCompilationError } from './workflow-compilation-error'

export { WorkflowCompilationError } from './workflow-compilation-error'

export type {
  ExecutionPlanNode,
  WorkflowExecutionPlan
} from '../../../shared/mam/domain/run-bundle'

export function parseWorkflowDefinition(source: string): WorkflowDefinition {
  let parsed: unknown
  try {
    parsed = JSON.parse(source)
  } catch {
    try {
      parsed = parseYaml(source)
    } catch (error) {
      throw new WorkflowCompilationError(
        'definition_parse_error',
        error instanceof Error ? error.message : String(error)
      )
    }
  }
  const definition = WorkflowDefinitionSchema.safeParse(parsed)
  if (!definition.success) {
    throw new WorkflowCompilationError(
      'definition_schema_error',
      definition.error.issues.map((issue) => issue.message).join('; ')
    )
  }
  return definition.data
}

export function compileWorkflow(
  definitionInput: unknown,
  inputArtifactsInput: readonly unknown[] = []
): WorkflowExecutionPlan {
  const result = WorkflowDefinitionSchema.safeParse(definitionInput)
  if (!result.success) {
    throw new WorkflowCompilationError(
      'definition_schema_error',
      result.error.issues.map((issue) => issue.message).join('; ')
    )
  }
  const definition = result.data
  const inputArtifacts = inputArtifactsInput.map((artifact) => ArtifactRefSchema.parse(artifact))
  const graphs = buildWorkflowGraphs(definition)
  const orderedNodeIds = validateWorkflowPlan(definition, inputArtifacts, graphs)
  const nodesById = new Map(definition.nodes.map((node) => [node.id, node]))
  const nodes = orderedNodeIds.map((nodeId, ordinal) => {
    const node = nodesById.get(nodeId)!
    return {
      id: nodeId,
      type: node.type,
      ordinal,
      dependencies: [...(graphs.base.incoming.get(nodeId) ?? [])].sort(),
      successors: [...(graphs.base.outgoing.get(nodeId) ?? [])].sort(),
      requiredArtifacts: requiredArtifactRefs(node)
        .map((artifact) => artifact.artifactId)
        .sort(),
      producedArtifacts: producedArtifactTypes(node).sort()
    }
  })
  const edges = definition.edges
    .map((edge) => ({ ...edge }))
    .sort((a, b) => edgeKey(a).localeCompare(edgeKey(b)))
  const sortedInputs = [...inputArtifacts].sort((a, b) =>
    artifactKey(a).localeCompare(artifactKey(b))
  )
  const payload = {
    schemaVersion: '1.0.0' as const,
    definitionId: definition.id,
    definitionVersion: definition.version,
    nodes,
    edges,
    inputArtifacts: sortedInputs,
    maxTransitions: definition.maxTransitions,
    maxRunCostUsd: definition.maxRunCostUsd,
    maxRunDurationSeconds: definition.maxRunDurationSeconds
  }
  return deepFreeze(
    WorkflowExecutionPlanSchema.parse({
      ...payload,
      planHash: createHash('sha256').update(canonicalJson(payload)).digest('hex')
    })
  )
}

function artifactKey(artifact: ArtifactRef): string {
  return `${artifact.artifactId}:${artifact.version}:${artifact.contentHash}`
}

function edgeKey(edge: {
  from: string
  to: string
  when?: string | undefined
  maxTraversals?: number | undefined
}): string {
  return `${edge.from}\0${edge.to}\0${edge.when ?? ''}\0${edge.maxTraversals ?? ''}`
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) deepFreeze(child)
    Object.freeze(value)
  }
  return value
}
