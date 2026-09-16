import type { ArtifactRef } from '../../../shared/mam/domain/artifact'
import type { WorkflowRunBundle } from '../../../shared/mam/domain/run-bundle'
import type { WorkflowRunProjection } from '../state-store/git-state-projection'
import type {
  AttemptInputArtifactContext,
  AttemptIntegrationBase
} from './mam-attempt-execution-types'
import { mergeNodeHasCompleted } from './merge-node-projection'

export type AttemptHandoffContext = Readonly<{
  inputArtifacts: readonly AttemptInputArtifactContext[]
  integrationBase?: AttemptIntegrationBase
}>

export function resolveAttemptHandoffContext(input: {
  bundle: WorkflowRunBundle
  projection: WorkflowRunProjection
  nodeId: string
  inputArtifacts: readonly ArtifactRef[]
  requireIntegratedRoleInputs: boolean
  isCommitAncestor?(targetBranch: string, ancestor: string, descendant: string): boolean
}): AttemptHandoffContext {
  const ancestors = ancestorNodeIds(input.bundle, input.nodeId)
  const integrationBase = nearestIntegrationBase(
    input.bundle,
    input.projection,
    ancestors,
    input.isCommitAncestor
  )
  const inputArtifacts = input.inputArtifacts.map((artifact) =>
    resolveInputArtifact(input.bundle, input.projection, ancestors, artifact)
  )
  if (input.requireIntegratedRoleInputs) {
    assertRoleInputsIntegrated(input.bundle, input.projection, input.nodeId, inputArtifacts)
  }
  return { inputArtifacts, ...(integrationBase ? { integrationBase } : {}) }
}

function resolveInputArtifact(
  bundle: WorkflowRunBundle,
  projection: WorkflowRunProjection,
  ancestors: ReadonlySet<string>,
  artifact: ArtifactRef
): AttemptInputArtifactContext {
  const definitions = [...bundle.taskCatalog, ...Object.values(projection.dynamicTasks)].filter(
    (definition) =>
      ancestors.has(definition.nodeId) &&
      definition.outputContracts.some((contract) => contract.artifactType === artifact.artifactId)
  )
  const candidates = definitions.flatMap((definition) => {
    const task = projection.tasks[definition.id]
    const attemptId = task?.selectedAttemptId ?? task?.knownAttemptIds.at(-1)
    const attempt = attemptId ? projection.attempts[attemptId] : undefined
    const claim = attempt?.result?.artifacts.find((item) => item.type === artifact.artifactId)
    const sourceCommit = attempt?.result?.system.submittedCommit
    if (!attemptId || attempt?.status !== 'submitted' || !claim || !sourceCommit) return []
    const contract = definition.outputContracts.find(
      (item) => item.artifactType === artifact.artifactId
    )!
    return [
      {
        artifactType: artifact.artifactId,
        source: 'workflow' as const,
        expectedHash: claim.sha256,
        producerNodeId: definition.nodeId,
        producerTaskId: definition.id,
        producerAttemptId: attemptId,
        sourceCommit,
        contentLocations: artifactLocations(claim.contentRef, contract.allowedGlobs)
      }
    ]
  })
  if (candidates.length > 1) {
    throw new Error(`workflow_artifact_ambiguous:${artifact.artifactId}`)
  }
  return (
    candidates[0] ?? {
      artifactType: artifact.artifactId,
      source: 'external',
      expectedHash: artifact.contentHash,
      contentLocations: []
    }
  )
}

function artifactLocations(
  contentRef: string,
  allowedGlobs: readonly string[] | undefined
): readonly string[] {
  if (contentRef.startsWith('workspace:file-set:')) return [...(allowedGlobs ?? [])]
  if (contentRef.startsWith('workspace:')) return [contentRef.slice('workspace:'.length)]
  if (contentRef.startsWith('git:diff:')) return []
  return [contentRef]
}

function assertRoleInputsIntegrated(
  bundle: WorkflowRunBundle,
  projection: WorkflowRunProjection,
  consumerNodeId: string,
  artifacts: readonly AttemptInputArtifactContext[]
): void {
  for (const artifact of artifacts) {
    if (artifact.source !== 'workflow' || !artifact.producerNodeId || !artifact.producerTaskId) {
      continue
    }
    const integrated = bundle.definition.nodes.some(
      (node) =>
        node.type === 'git_merge' &&
        isAncestor(bundle, artifact.producerNodeId!, node.id) &&
        isAncestor(bundle, node.id, consumerNodeId) &&
        mergeNodeHasCompleted(node.id, projection, bundle) &&
        Object.values(projection.mergeQueueEntries).some(
          (entry) =>
            entry.mergeNodeId === node.id &&
            entry.taskId === artifact.producerTaskId &&
            entry.status === 'merged'
        )
    )
    if (!integrated) {
      throw new Error(`workflow_role_handoff_not_integrated:${artifact.artifactType}`)
    }
  }
}

function nearestIntegrationBase(
  bundle: WorkflowRunBundle,
  projection: WorkflowRunProjection,
  ancestors: ReadonlySet<string>,
  isCommitAncestor:
    | ((targetBranch: string, ancestor: string, descendant: string) => boolean)
    | undefined
): AttemptIntegrationBase | undefined {
  const candidates = bundle.definition.nodes.filter(
    (node) =>
      node.type === 'git_merge' &&
      ancestors.has(node.id) &&
      mergeNodeHasCompleted(node.id, projection, bundle)
  )
  const nearest = candidates.filter(
    (candidate) =>
      !candidates.some(
        (other) => candidate.id !== other.id && isAncestor(bundle, candidate.id, other.id)
      )
  )
  if (nearest.length > 1) throw new Error('workflow_integration_base_ambiguous')
  const node = nearest[0]
  if (!node || node.type !== 'git_merge') return undefined
  const entries = Object.values(projection.mergeQueueEntries).filter(
    (candidate) =>
      candidate.mergeNodeId === node.id &&
      candidate.status === 'merged' &&
      Boolean(candidate.mergeCommit)
  )
  const entry = terminalMergeEntry(entries, node.targetBranch, isCommitAncestor)
  if (!entry?.mergeCommit) throw new Error('workflow_integration_commit_missing')
  return { mergeNodeId: node.id, targetBranch: node.targetBranch, mergeCommit: entry.mergeCommit }
}

function terminalMergeEntry(
  entries: readonly WorkflowRunProjection['mergeQueueEntries'][string][],
  targetBranch: string,
  isCommitAncestor:
    | ((targetBranch: string, ancestor: string, descendant: string) => boolean)
    | undefined
) {
  const uniqueEntries = [
    ...new Map(entries.map((entry) => [entry.mergeCommit!, entry] as const)).values()
  ]
  if (uniqueEntries.length <= 1) return uniqueEntries[0]
  if (!isCommitAncestor) throw new Error('workflow_integration_ancestry_reader_missing')
  const terminal = uniqueEntries.filter((candidate) =>
    uniqueEntries.every(
      (other) =>
        candidate.id === other.id ||
        isCommitAncestor(targetBranch, other.mergeCommit!, candidate.mergeCommit!)
    )
  )
  if (terminal.length !== 1) throw new Error('workflow_integration_commit_ambiguous')
  return terminal[0]
}

function ancestorNodeIds(bundle: WorkflowRunBundle, nodeId: string): ReadonlySet<string> {
  const predecessors = new Map<string, string[]>()
  for (const edge of bundle.definition.edges) {
    predecessors.set(edge.to, [...(predecessors.get(edge.to) ?? []), edge.from])
  }
  const result = new Set<string>()
  const pending = [...(predecessors.get(nodeId) ?? [])]
  while (pending.length > 0) {
    const current = pending.shift()!
    if (result.has(current)) continue
    result.add(current)
    pending.push(...(predecessors.get(current) ?? []))
  }
  return result
}

function isAncestor(bundle: WorkflowRunBundle, sourceId: string, targetId: string): boolean {
  return ancestorNodeIds(bundle, targetId).has(sourceId)
}
