import { ReviewSubjectSchema, type ReviewSubject } from '../../../shared/mam/domain/review'
import type { WorkflowRunBundle } from '../../../shared/mam/domain/run-bundle'
import type { WorkflowRunProjection } from '../state-store/git-state-projection'
import { profileContentHash } from '../profiles/profile-content-hash'

export function latestSubmittedReviewSubject(
  projection: WorkflowRunProjection,
  taskId: string
): ReviewSubject | undefined {
  const task = projection.tasks[taskId]
  const attemptId = task?.selectedAttemptId ?? task?.knownAttemptIds.at(-1)
  const attempt = attemptId ? projection.attempts[attemptId] : undefined
  if (!attemptId || attempt?.status !== 'submitted' || !attempt.result) return undefined
  return ReviewSubjectSchema.parse({
    taskId,
    attemptId,
    resultHash: profileContentHash(attempt.result),
    artifactHashes: attempt.result.artifacts.map((artifact) => artifact.sha256),
    ...(attempt.result.system.submittedCommit
      ? { submittedCommit: attempt.result.system.submittedCommit }
      : {})
  })
}

export function reachableReviewNodeIds(
  bundle: WorkflowRunBundle,
  sourceNodeId: string
): readonly string[] {
  return reachableNodeIds(
    bundle,
    sourceNodeId,
    new Set(
      bundle.definition.nodes.filter((node) => node.type === 'review_gate').map((node) => node.id)
    ),
    new Set(bundle.taskCatalog.map((task) => task.nodeId))
  )
}

export function reachableGitMergeNodeIds(
  bundle: WorkflowRunBundle,
  sourceNodeId: string
): readonly string[] {
  return reachableNodeIds(
    bundle,
    sourceNodeId,
    new Set(
      bundle.definition.nodes.filter((node) => node.type === 'git_merge').map((node) => node.id)
    )
  )
}

function reachableNodeIds(
  bundle: WorkflowRunBundle,
  sourceNodeId: string,
  targetNodeIds: ReadonlySet<string>,
  blockingNodeIds: ReadonlySet<string> = new Set()
): readonly string[] {
  const successors = new Map<string, string[]>()
  for (const edge of bundle.definition.edges) {
    const values = successors.get(edge.from) ?? []
    values.push(edge.to)
    successors.set(edge.from, values)
  }
  const visited = new Set<string>()
  const pending = [...(successors.get(sourceNodeId) ?? [])]
  const reachable: string[] = []
  while (pending.length > 0) {
    const nodeId = pending.shift()!
    if (visited.has(nodeId)) continue
    visited.add(nodeId)
    // A later executable Task owns its downstream Review; an earlier Task cannot skip over it.
    if (blockingNodeIds.has(nodeId) && nodeId !== sourceNodeId) continue
    if (targetNodeIds.has(nodeId)) reachable.push(nodeId)
    pending.push(...(successors.get(nodeId) ?? []))
  }
  return reachable.sort()
}
