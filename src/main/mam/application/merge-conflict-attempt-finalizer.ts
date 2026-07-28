import { AttemptResultSchema, type AttemptResult } from '../../../shared/mam/domain/attempt-result'
import type { SchedulerCommand } from '../../../shared/mam/scheduler-protocol'
import type { GitCommandClient } from '../state-store/git-command-client'
import { GitCommandRetryCoordinator } from '../state-store/git-command-retry-coordinator'
import type { GitStateRepository } from '../state-store/git-state-repository'
import type { ConflictResolutionWorktreeManager } from './conflict-resolution-worktree-manager'
import { createMergeConflictResolution } from './merge-conflict-task-service'
import type { PreparedAttempt } from './mam-attempt-execution-types'
import { dirname } from 'node:path'
import { advanceDeterministicNodes } from './deterministic-node-advancement'

export function finalizeMergeConflictAttempt(input: {
  prepared: PreparedAttempt
  result: AttemptResult
  validArtifactHashes: ReadonlySet<string>
  repository: GitStateRepository
  conflicts: ConflictResolutionWorktreeManager
  git: GitCommandClient
  schedulerId: string
  commandId(): string
  now(): string
}): AttemptResult {
  const task = input.prepared.task.mergeConflictTask
  if (!task) throw new Error('merge_conflict_task_required')
  input.git.run(input.prepared.worktree.path, ['add', '--all'])
  input.git.run(input.prepared.worktree.path, [
    '-c',
    'user.name=MAM Merge Coordinator',
    '-c',
    'user.email=mam-merge@example.invalid',
    'commit',
    '--no-verify',
    '-m',
    `mam: resolve ${task.id}`
  ])
  const resolutionCommit = input.git.run(input.prepared.worktree.path, [
    'rev-parse',
    '--verify',
    'HEAD^{commit}'
  ])
  const completedAt = input.now()
  const resolutionResult = input.conflicts.finalize({
    repositoryPath: input.repository.projectDirectory,
    integrationRoot: dirname(input.prepared.worktree.path),
    remoteName: input.repository.remote,
    task,
    resolutionAttemptId: input.prepared.attemptId,
    resolutionCommit,
    completedAt
  })
  if (resolutionResult.status !== 'merged') {
    throw new Error(`${resolutionResult.stage}: ${resolutionResult.reason}`)
  }
  const authoritative = AttemptResultSchema.parse({
    ...input.result,
    system: { ...input.result.system, submittedCommit: resolutionCommit }
  })
  const coordinator = new GitCommandRetryCoordinator(input.repository)
  coordinator.executeAndPush({
    command: resultCommand(input.prepared, authoritative, input.commandId(), input.now()),
    schedulerId: input.schedulerId,
    validArtifactHashes: input.validArtifactHashes
  })
  const resolution = createMergeConflictResolution({ task, result: resolutionResult })
  coordinator.executeAndPush({
    command: {
      schemaVersion: '1.0.0',
      commandId: input.commandId(),
      issuedAt: input.now(),
      workflowRunId: input.prepared.workflowRunId,
      taskId: input.prepared.taskId,
      actor: { kind: 'scheduler', schedulerId: input.schedulerId },
      type: 'record_merge_conflict_resolution',
      attemptId: input.prepared.attemptId,
      resolution
    },
    schedulerId: input.schedulerId
  })
  advanceDeterministicNodes({
    repository: input.repository,
    workflowRunId: input.prepared.workflowRunId,
    schedulerId: input.schedulerId,
    nextCommandId: input.commandId,
    now: input.now
  })
  return authoritative
}

function resultCommand(
  prepared: PreparedAttempt,
  result: AttemptResult,
  commandId: string,
  issuedAt: string
): Extract<SchedulerCommand, { type: 'submit_attempt_result' }> {
  return {
    schemaVersion: '1.0.0',
    commandId,
    issuedAt,
    workflowRunId: prepared.workflowRunId,
    taskId: prepared.taskId,
    actor: {
      kind: 'executor',
      roleInstanceId: prepared.roleInstanceId,
      attemptId: prepared.attemptId,
      executorInvocationId: prepared.executorInvocationId
    },
    type: 'submit_attempt_result',
    attemptId: prepared.attemptId,
    result
  }
}
