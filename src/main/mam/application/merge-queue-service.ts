import { createHash } from 'node:crypto'
import { MergeQueueEntrySchema, type MergeQueueEntry } from '../../../shared/mam/domain/merge-queue'
import type { MergeConflictResolution } from '../../../shared/mam/domain/merge-conflict-task'
import type { WorkflowRunBundle } from '../../../shared/mam/domain/run-bundle'
import type { WorkflowRunProjection } from '../state-store/git-state-projection'
import { profileContentHash } from '../profiles/profile-content-hash'
import { resolvedReviewStatus } from './review-disagreement-resolution'
import { executableMergeValidationCommands } from './merge-validation-policy'

export class MergeQueueError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message)
    this.name = 'MergeQueueError'
  }
}

export function createMergeQueueEntry(input: {
  bundle: WorkflowRunBundle
  projection: WorkflowRunProjection
  mergeNodeId: string
  taskId: string
  sourceBranch: string
  mergeReadyAt: string
  validationEvidence: Readonly<Record<string, string>>
}): MergeQueueEntry {
  const node = input.bundle.definition.nodes.find((candidate) => candidate.id === input.mergeNodeId)
  if (!node || node.type !== 'git_merge') {
    fail('merge_node_invalid', 'Merge readiness requires a git_merge node')
  }
  const task = input.projection.tasks[input.taskId]
  const promotion = promotionSource(input.bundle, input.projection, node.id, input.taskId)
  if (!task || (task.status !== 'approved' && !(task.status === 'completed' && promotion))) {
    fail('merge_review_required', 'Merge candidate is not approved')
  }
  const attemptId = task.selectedAttemptId ?? task.knownAttemptIds.at(-1)
  const attempt = attemptId ? input.projection.attempts[attemptId] : undefined
  if (!attemptId || !attempt || attempt.status !== 'submitted' || !attempt.result) {
    fail('merge_attempt_invalid', 'Merge candidate has no latest submitted Attempt Result')
  }
  const reviewedCommit = attempt.result.system.submittedCommit
  if (!reviewedCommit) fail('merge_commit_required', 'Code merge candidate has no submitted commit')
  const resultHash = profileContentHash(attempt.result)
  const reviews = task.reviewIds.flatMap((reviewId) => {
    const review = input.projection.reviews[reviewId]
    return review && input.projection.reviewValidity[reviewId]?.status === 'valid' ? [review] : []
  })
  const aggregation = Object.values(input.projection.reviewAggregations).find(
    (candidate) =>
      candidate.subject.taskId === input.taskId &&
      candidate.subject.attemptId === attemptId &&
      resolvedReviewStatus(candidate, input.projection) === 'approved'
  )
  if (
    !aggregation ||
    aggregation.sourceDecisionIds.some((id) => !reviews.some((r) => r.id === id))
  ) {
    fail('merge_review_stale', 'Merge candidate has no valid approved Review aggregation')
  }
  if (
    aggregation.subject.resultHash !== resultHash ||
    aggregation.subject.submittedCommit !== reviewedCommit
  ) {
    fail('merge_revision_mismatch', 'Approved Review targets another result revision')
  }
  assertValidationEvidence(
    executableMergeValidationCommands(node.validations),
    input.validationEvidence
  )
  const ready = {
    workflowRunId: input.bundle.run.id,
    mergeNodeId: node.id,
    taskId: input.taskId,
    attemptId,
    targetBranch: node.targetBranch,
    sourceBranch: promotion?.targetBranch ?? input.sourceBranch,
    submittedCommit: promotion?.mergeCommit ?? reviewedCommit,
    resultHash,
    mergeReadyAt: input.mergeReadyAt,
    reviewDecisionIds: aggregation.sourceDecisionIds,
    validationEvidence: input.validationEvidence,
    strategy: node.strategy,
    conflictPolicy: node.conflictPolicy
  }
  const readyRevisionHash = profileContentHash(ready)
  return MergeQueueEntrySchema.parse({
    schemaVersion: '1.0.0',
    id: `merge-entry.${digest(readyRevisionHash).slice(0, 40)}`,
    ...ready,
    readyRevisionHash,
    status: 'queued'
  })
}

function promotionSource(
  bundle: WorkflowRunBundle,
  projection: WorkflowRunProjection,
  mergeNodeId: string,
  taskId: string
): MergeQueueEntry | undefined {
  const ancestors = ancestorNodeIds(bundle, mergeNodeId)
  return Object.values(projection.mergeQueueEntries)
    .filter(
      (entry) =>
        entry.taskId === taskId &&
        entry.status === 'merged' &&
        ancestors.has(entry.mergeNodeId) &&
        Boolean(entry.mergeCommit)
    )
    .sort((left, right) => right.completedAt!.localeCompare(left.completedAt!))[0]
}

function ancestorNodeIds(bundle: WorkflowRunBundle, nodeId: string): ReadonlySet<string> {
  const predecessors = new Map<string, string[]>()
  for (const edge of bundle.definition.edges) {
    predecessors.set(edge.to, [...(predecessors.get(edge.to) ?? []), edge.from])
  }
  const ancestors = new Set<string>()
  const pending = [...(predecessors.get(nodeId) ?? [])]
  while (pending.length > 0) {
    const candidate = pending.shift()!
    if (ancestors.has(candidate)) continue
    ancestors.add(candidate)
    pending.push(...(predecessors.get(candidate) ?? []))
  }
  return ancestors
}

export class MergeQueue {
  private constructor(private readonly entries: readonly MergeQueueEntry[]) {}

  static create(entries: readonly MergeQueueEntry[] = []): MergeQueue {
    const parsed = entries.map((entry) => MergeQueueEntrySchema.parse(entry))
    if (new Set(parsed.map((entry) => entry.id)).size !== parsed.length) {
      fail('duplicate_merge_entry', 'Merge Queue entry ID is duplicated')
    }
    return new MergeQueue(Object.freeze(parsed))
  }

  list(): readonly MergeQueueEntry[] {
    return [...this.entries].sort(compareMergeEntries)
  }

  claimNext(claimedAt: string): { queue: MergeQueue; entry?: MergeQueueEntry } {
    if (this.entries.some((entry) => entry.status === 'merging')) {
      fail('merge_already_running', 'Merge Queue already has an active entry')
    }
    const next = this.list().find((entry) => entry.status === 'queued')
    if (!next) return { queue: this }
    const claimed = MergeQueueEntrySchema.parse({ ...next, status: 'merging', claimedAt })
    return { queue: this.replace(claimed), entry: claimed }
  }

  markConflict(entryId: string, conflictTaskId: string, detectedAt: string): MergeQueue {
    const entry = this.requireMerging(entryId)
    return this.replace(
      MergeQueueEntrySchema.parse({ ...entry, status: 'conflict', conflictTaskId, detectedAt })
    )
  }

  markMerged(entryId: string, mergeCommit: string, completedAt: string): MergeQueue {
    const entry = this.requireMerging(entryId)
    return this.replace(
      MergeQueueEntrySchema.parse({ ...entry, status: 'merged', mergeCommit, completedAt })
    )
  }

  markConflictResolved(entryId: string, resolution: MergeConflictResolution): MergeQueue {
    const entry = this.entries.find((candidate) => candidate.id === entryId)
    if (
      !entry ||
      entry.status !== 'conflict' ||
      entry.conflictTaskId !== resolution.conflictTaskId ||
      entry.id !== resolution.queueEntryId ||
      entry.workflowRunId !== resolution.workflowRunId
    ) {
      fail('merge_conflict_lineage_mismatch', 'Resolution targets another Merge Queue conflict')
    }
    return this.replace(
      MergeQueueEntrySchema.parse({
        ...entry,
        status: 'merged',
        resolutionAttemptId: resolution.resolutionAttemptId,
        mergeCommit: resolution.mergeCommit,
        completedAt: resolution.completedAt
      })
    )
  }

  markFailed(entryId: string, failureReason: string, completedAt: string): MergeQueue {
    const entry = this.requireMerging(entryId)
    return this.replace(
      MergeQueueEntrySchema.parse({ ...entry, status: 'failed', failureReason, completedAt })
    )
  }

  supersedeTask(taskId: string, replacementCommit: string, supersededAt: string): MergeQueue {
    return new MergeQueue(
      this.entries.map((entry) =>
        entry.taskId === taskId && entry.status === 'queued'
          ? MergeQueueEntrySchema.parse({
              ...entry,
              status: 'superseded',
              supersededByCommit: replacementCommit,
              supersededAt
            })
          : entry
      )
    )
  }

  private requireMerging(entryId: string): MergeQueueEntry {
    const entry = this.entries.find((candidate) => candidate.id === entryId)
    if (!entry || entry.status !== 'merging') {
      fail('merge_entry_not_active', 'Merge Queue entry is not active')
    }
    return entry
  }

  private replace(replacement: MergeQueueEntry): MergeQueue {
    return new MergeQueue(
      this.entries.map((entry) => (entry.id === replacement.id ? replacement : entry))
    )
  }
}

function compareMergeEntries(left: MergeQueueEntry, right: MergeQueueEntry): number {
  return (
    left.mergeReadyAt.localeCompare(right.mergeReadyAt) ||
    left.taskId.localeCompare(right.taskId) ||
    left.id.localeCompare(right.id)
  )
}

function assertValidationEvidence(
  validations: readonly string[],
  evidence: Readonly<Record<string, string>>
): void {
  const expected = [...validations].sort()
  const actual = Object.keys(evidence).sort()
  if (JSON.stringify(expected) !== JSON.stringify(actual)) {
    fail('merge_validation_incomplete', 'Merge validation evidence does not match the node policy')
  }
  for (const value of Object.values(evidence)) {
    if (!/^[0-9a-f]{64}$/.test(value)) fail('merge_validation_invalid', 'Evidence hash is invalid')
  }
}

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function fail(code: string, message: string): never {
  throw new MergeQueueError(code, message)
}
