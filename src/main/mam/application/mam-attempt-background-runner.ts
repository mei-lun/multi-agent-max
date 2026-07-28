import { AttemptResultSchema, type AttemptResult } from '../../../shared/mam/domain/attempt-result'
import { existsSync } from 'node:fs'
import type { SchedulerCommand } from '../../../shared/mam/scheduler-protocol'
import type { ExecutorUsage } from '../../../shared/mam/executor-events'
import type { DiagnosticsRecorder } from '../diagnostics/diagnostics-recorder'
import { GitCommandRetryCoordinator } from '../state-store/git-command-retry-coordinator'
import type { GitStateRepository } from '../state-store/git-state-repository'
import type { AttemptArtifactValidator } from './attempt-artifact-validator'
import type { AttemptWorktreeManager } from './attempt-worktree-manager'
import type { ConflictResolutionWorktreeManager } from './conflict-resolution-worktree-manager'
import type { GitCommandClient } from '../state-store/git-command-client'
import type { ExecutorRouter, PreparedAttempt } from './mam-attempt-execution-types'
import { advanceReadyReviewPanel } from './review-panel-advancement'
import { finalizeMergeConflictAttempt } from './merge-conflict-attempt-finalizer'
import { advanceDynamicTaskPlan } from './dynamic-task-advancement'
import { advanceDeterministicNodes } from './deterministic-node-advancement'

export async function runPreparedAttempt(input: {
  prepared: PreparedAttempt
  executor: ExecutorRouter
  artifacts: AttemptArtifactValidator
  worktrees: AttemptWorktreeManager
  conflicts: ConflictResolutionWorktreeManager
  git: GitCommandClient
  repository: GitStateRepository
  diagnostics: DiagnosticsRecorder
  schedulerId: string
  now(): string
  createId(kind: string): string
}): Promise<void> {
  const { prepared } = input
  try {
    const execution = await input.executor.execute({
      profile: prepared.profile,
      binding: prepared.binding,
      snapshot: prepared.snapshot,
      resources: prepared.resources,
      executorInvocationId: prepared.executorInvocationId,
      workspacePath: prepared.worktree.path,
      systemPrompt: prepared.systemPrompt,
      prompt: prepared.prompt,
      credentialValues: prepared.credentialValues,
      authority: attemptAuthority(prepared, input.now())
    })
    for (const event of execution.events) record(input, 'executor', { event })
    const validated = await input.artifacts.validate({
      result: execution.result,
      outputContracts: prepared.task.outputContracts,
      workspacePath: prepared.worktree.path,
      workflowRunId: prepared.workflowRunId,
      nodeRunId: prepared.task.nodeRunId,
      taskId: prepared.taskId,
      attemptId: prepared.attemptId,
      roleInstanceId: prepared.roleInstanceId,
      inputArtifacts: prepared.task.inputArtifacts
    })
    const authoritative = prepared.task.mergeConflictTask
      ? finalizeMergeConflictAttempt({
          prepared,
          result: validated.result,
          validArtifactHashes: validated.validHashes,
          repository: input.repository,
          conflicts: input.conflicts,
          git: input.git,
          schedulerId: input.schedulerId,
          commandId: () => input.createId('command'),
          now: input.now
        })
      : finalizeRegularAttempt(input, validated.result, validated.validHashes)
    record(input, 'executor', {
      status: 'result_submitted',
      submittedCommit: authoritative.system.submittedCommit
    })
    if (prepared.task.mergeConflictTask) {
      recordCost(input, execution.usage)
      return
    }
    try {
      const created = advanceDynamicTaskPlan({
        prepared,
        validated,
        submittedCommit: authoritative.system.submittedCommit!,
        repository: input.repository,
        schedulerId: input.schedulerId,
        commandId: input.createId('command'),
        issuedAt: input.now()
      })
      if (created) record(input, 'scheduler', { status: 'dynamic_tasks_created' })
    } catch (error) {
      record(input, 'scheduler', {
        status: 'dynamic_task_advancement_failed',
        errorCode: errorCode(error),
        message: error instanceof Error ? error.message : String(error)
      })
    }
    try {
      const resolved = advanceDeterministicNodes({
        repository: input.repository,
        workflowRunId: prepared.workflowRunId,
        schedulerId: input.schedulerId,
        nextCommandId: () => input.createId('command'),
        now: input.now
      })
      if (resolved.conditions.length > 0 || resolved.systemNodes.length > 0) {
        record(input, 'scheduler', resolved)
      }
    } catch (error) {
      record(input, 'scheduler', {
        status: 'condition_advancement_failed',
        errorCode: errorCode(error),
        message: error instanceof Error ? error.message : String(error)
      })
    }
    try {
      const created = advanceReadyReviewPanel({
        repository: input.repository,
        workflowRunId: prepared.workflowRunId,
        sourceTaskId: prepared.taskId,
        sourceNodeId: prepared.nodeId,
        schedulerId: input.schedulerId,
        commandId: input.createId('command'),
        issuedAt: input.now()
      })
      if (created) record(input, 'scheduler', { status: 'review_panel_created' })
    } catch (error) {
      record(input, 'scheduler', {
        status: 'review_panel_advancement_failed',
        errorCode: errorCode(error),
        message: error instanceof Error ? error.message : String(error)
      })
    }
    recordCost(input, execution.usage)
  } catch (error) {
    record(input, 'executor', {
      status: 'execution_interrupted',
      errorCode: errorCode(error),
      message: error instanceof Error ? error.message : String(error),
      worktreeRetained: existsSync(prepared.worktree.path)
    })
  }
}

function finalizeRegularAttempt(
  input: Parameters<typeof runPreparedAttempt>[0],
  result: AttemptResult,
  validArtifactHashes: ReadonlySet<string>
): AttemptResult {
  const finalized = input.worktrees.finalize({
    repositoryPath: input.repository.projectDirectory,
    remoteName: input.repository.remote,
    attemptId: input.prepared.attemptId,
    worktree: input.prepared.worktree
  })
  const authoritative = AttemptResultSchema.parse({
    ...result,
    system: { ...result.system, submittedCommit: finalized.submittedCommit }
  })
  new GitCommandRetryCoordinator(input.repository).executeAndPush({
    command: resultCommand(input.prepared, authoritative, input.createId('command'), input.now()),
    schedulerId: input.schedulerId,
    validArtifactHashes
  })
  return authoritative
}

function recordCost(input: Parameters<typeof runPreparedAttempt>[0], usage: ExecutorUsage): void {
  input.diagnostics.recordCost({
    ...diagnosticIdentity(input.prepared, input.now()),
    usage: {
      inputTokens: usage.inputTokens ?? null,
      outputTokens: usage.outputTokens ?? null,
      costUsd: usage.costUsd ?? null,
      status:
        usage.status === 'known' ? 'reported' : usage.status === 'partial' ? 'partial' : 'unknown'
    }
  })
}

function attemptAuthority(prepared: PreparedAttempt, createdAt: string) {
  return {
    workflowRunId: prepared.workflowRunId,
    nodeRunId: prepared.task.nodeRunId,
    taskId: prepared.taskId,
    attemptId: prepared.attemptId,
    roleInstanceId: prepared.roleInstanceId,
    executorInvocationId: prepared.executorInvocationId,
    effectiveConfigHash: prepared.snapshot.contentHash,
    createdAt
  }
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

function record(
  input: Parameters<typeof runPreparedAttempt>[0],
  kind: 'scheduler' | 'executor',
  payload: Readonly<Record<string, unknown>>
): void {
  input.diagnostics.record({
    ...diagnosticIdentity(input.prepared, input.now()),
    kind,
    payload
  })
}

function diagnosticIdentity(prepared: PreparedAttempt, at: string) {
  return {
    at,
    workflowRunId: prepared.workflowRunId,
    nodeId: prepared.nodeId,
    roleInstanceId: prepared.roleInstanceId,
    executorInvocationId: prepared.executorInvocationId
  }
}

function errorCode(error: unknown): string {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String(error.code)
    : 'execution_error'
}
