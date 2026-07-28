import type { MergeQueueEntry } from '../../../shared/mam/domain/merge-queue'
import {
  MergeConflictResolutionSchema,
  MergeConflictTaskDefinitionSchema,
  type MergeConflictResolution,
  type MergeConflictTaskDefinition
} from '../../../shared/mam/domain/merge-conflict-task'
import type { WorkflowRunBundle } from '../../../shared/mam/domain/run-bundle'
import { profileContentHash } from '../profiles/profile-content-hash'
import type { IntegrationMergeResult } from './integration-worktree-merge-executor'
import type { ConflictResolutionResult } from './conflict-resolution-worktree-manager'

export class MergeConflictTaskError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message)
    this.name = 'MergeConflictTaskError'
  }
}

export function createMergeConflictTask(input: {
  bundle: WorkflowRunBundle
  entry: MergeQueueEntry
  result: Extract<IntegrationMergeResult, { status: 'conflict' }>
  createdAt: string
}): MergeConflictTaskDefinition {
  const node = input.bundle.definition.nodes.find(
    (candidate) => candidate.id === input.entry.mergeNodeId
  )
  if (!node || node.type !== 'git_merge') {
    fail('merge_node_invalid', 'Conflict Task requires its original git_merge node')
  }
  if (input.entry.status !== 'merging') {
    fail('merge_entry_not_active', 'Conflict Task requires an active Merge Queue entry')
  }
  if (
    input.bundle.run.id !== input.entry.workflowRunId ||
    input.result.submittedCommit !== input.entry.submittedCommit
  ) {
    fail('merge_conflict_lineage_mismatch', 'Conflict evidence targets another ready revision')
  }
  const identity = {
    workflowRunId: input.entry.workflowRunId,
    mergeNodeId: input.entry.mergeNodeId,
    queueEntryId: input.entry.id,
    targetCommit: input.result.targetCommitBefore,
    submittedCommit: input.result.submittedCommit,
    mergeBase: input.result.mergeBase,
    conflictingPaths: [...input.result.conflictingPaths].sort()
  }
  return MergeConflictTaskDefinitionSchema.parse({
    schemaVersion: '1.0.0',
    id: `merge-conflict-task.${profileContentHash(identity).slice(0, 40)}`,
    ...identity,
    parentTaskId: input.entry.taskId,
    parentAttemptId: input.entry.attemptId,
    targetBranch: input.entry.targetBranch,
    sourceBranch: input.entry.sourceBranch,
    validationCommands: node.validations,
    recommendedRoleProfileIds: node.recommendedRoleProfileIds,
    allowedRoleProfileIds: node.allowedRoleProfileIds,
    initialStatus: 'waiting_role_assignment',
    createdAt: input.createdAt
  })
}

export function createMergeConflictResolution(input: {
  task: MergeConflictTaskDefinition
  result: Extract<ConflictResolutionResult, { status: 'merged' }>
}): MergeConflictResolution {
  if (
    input.result.queueEntryId !== input.task.queueEntryId ||
    input.result.conflictTaskId !== input.task.id
  ) {
    fail('merge_conflict_lineage_mismatch', 'Resolution targets another conflict Task')
  }
  const validationEvidence = Object.fromEntries(
    input.result.validations.map((result) => [result.command, result.evidenceHash])
  )
  if (Object.keys(validationEvidence).length !== input.result.validations.length) {
    fail('merge_validation_duplicated', 'Resolution validation commands are duplicated')
  }
  const base = {
    workflowRunId: input.task.workflowRunId,
    queueEntryId: input.task.queueEntryId,
    conflictTaskId: input.task.id,
    resolutionAttemptId: input.result.resolutionAttemptId,
    mergeCommit: input.result.mergeCommit,
    validationEvidence,
    completedAt: input.result.completedAt
  }
  return MergeConflictResolutionSchema.parse({
    schemaVersion: '1.0.0',
    id: `merge-conflict-resolution.${profileContentHash(base).slice(0, 40)}`,
    ...base
  })
}

function fail(code: string, message: string): never {
  throw new MergeConflictTaskError(code, message)
}
