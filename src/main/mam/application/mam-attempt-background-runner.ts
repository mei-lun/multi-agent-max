import { existsSync } from 'node:fs'
import { diagnosticError } from '../diagnostics/diagnostic-error'
import type { DiagnosticsRecorder } from '../diagnostics/diagnostics-recorder'
import type { GitStateRepository } from '../state-store/git-state-repository'
import type { AttemptArtifactValidator } from './attempt-artifact-validator'
import type { AttemptWorktreeManager } from './attempt-worktree-manager'
import type { ConflictResolutionWorktreeManager } from './conflict-resolution-worktree-manager'
import type { GitCommandClient } from '../state-store/git-command-client'
import type { ExecutorRouter, PreparedAttempt } from './mam-attempt-execution-types'
import type { LocalExecutionDraftStore } from './local-execution-draft-store'
import { recordPreparedAttemptDraftState } from './prepared-attempt-draft'
import { advanceReadyReviewPanel } from './review-panel-advancement'
import { finalizeMergeConflictAttempt } from './merge-conflict-attempt-finalizer'
import { advanceDynamicTaskPlan } from './dynamic-task-advancement'
import { advanceDeterministicNodes } from './deterministic-node-advancement'
import { recordAttemptInterruption } from './attempt-interruption-recovery'
import { materializeDirectAttemptResult } from './direct-attempt-result'
import { collectPreparedAttemptResult } from './prepared-attempt-result-collector'
import {
  automaticReviewSubmission,
  publishAutomaticReviewSubmission
} from './automatic-review-submission'
import { shouldAutomaticallyRetryAttempt } from './attempt-automatic-retry'
import { publishRegularTaskDelivery } from './task-delivery-command-service'
import { normalizePreparedReviewContracts } from './automatic-review-contract'
import { AttemptExecutorEventObserver } from './attempt-executor-event-observer'
import { executePreparedAttemptWithTimeoutRecovery } from './prepared-attempt-execution-loop'
import { preparedAttemptResultAuthority } from './prepared-attempt-authority'
import { publishReviewAggregationIfReady } from './review-aggregation-publisher'
import { publishMergeReadinessIfEligible } from './merge-readiness-publisher'
import {
  attemptRunnerErrorCode as errorCode,
  recordAttemptRunnerStart,
  recordAttemptRunnerCost as recordCost,
  recordAttemptRunnerEvent as record
} from './attempt-runner-diagnostics'

export type PreparedAttemptRunnerInput = Readonly<{
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
  onActivityChanged?(): void
  drafts?: LocalExecutionDraftStore
}>

export async function runPreparedAttempt(input: PreparedAttemptRunnerInput): Promise<void> {
  let prepared = normalizePreparedReviewContracts(input.prepared)
  let runnerInput = { ...input, prepared }
  let eventObserver = new AttemptExecutorEventObserver(runnerInput)
  let executorCompleted = false
  try {
    recordAttemptRunnerStart(runnerInput)
    const executionState = await executePreparedAttemptWithTimeoutRecovery(input, prepared)
    prepared = executionState.prepared
    runnerInput = { ...input, prepared }
    eventObserver = executionState.eventObserver
    const execution = executionState.execution
    executorCompleted = executionState.executorCompleted
    eventObserver.recordReturned(execution.events)
    const collected = execution.result
      ? undefined
      : await collectPreparedAttemptResult({
          prepared,
          assistantText: execution.assistantText,
          usage: execution.usage,
          git: input.git,
          authority: preparedAttemptResultAuthority(prepared, input.now())
        })
    const validated = await input.artifacts.validate({
      result: execution.result ?? collected!.result,
      outputContracts: prepared.task.outputContracts,
      workspacePath: prepared.worktree.path,
      workflowRunId: prepared.workflowRunId,
      nodeRunId: prepared.task.nodeRunId,
      taskId: prepared.taskId,
      attemptId: prepared.attemptId,
      roleInstanceId: prepared.roleInstanceId,
      inputArtifacts: prepared.task.inputArtifacts,
      ...(collected ? { contentOverrides: collected.contents } : {})
    })
    if (collected && prepared.snapshot.permissions.writePaths.length === 0) {
      await materializeDirectAttemptResult(
        prepared.worktree.path,
        prepared.task.outputContracts,
        collected.contents
      )
    }
    const automaticReview = automaticReviewSubmission(prepared, validated)
    if (prepared.task.reviewTask && !automaticReview) {
      throw new Error('automatic_review_output_invalid')
    }
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
      : publishRegularTaskDelivery(
          runnerInput,
          validated.result,
          validated.validHashes,
          automaticReview
        )
    record(runnerInput, 'executor', {
      status: 'result_submitted',
      submittedCommit: authoritative.system.submittedCommit
    })
    const reviewPublication = prepared.task.reviewTask
      ? 'submitted'
      : publishAutomaticReviewSubmission({
          request: automaticReview,
          repository: input.repository,
          schedulerId: input.schedulerId,
          nextCommandId: () => input.createId('command'),
          now: input.now
        })
    if (reviewPublication === 'submitted') {
      record(runnerInput, 'scheduler', { status: 'automatic_review_submitted' })
      const reviewTask = prepared.task.reviewTask
      if (reviewTask) {
        try {
          const aggregated = publishReviewAggregationIfReady({
            repository: input.repository,
            workflowRunId: prepared.workflowRunId,
            reviewNodeId: reviewTask.reviewNodeId,
            subject: reviewTask.subject,
            schedulerId: input.schedulerId,
            commandId: input.createId('command'),
            issuedAt: input.now()
          })
          if (aggregated) {
            try {
              publishMergeReadinessIfEligible({
                repository: input.repository,
                workflowRunId: prepared.workflowRunId,
                taskId: reviewTask.subject.taskId,
                schedulerId: input.schedulerId,
                commandId: input.createId('command'),
                issuedAt: input.now()
              })
            } catch (error) {
              record(runnerInput, 'scheduler', {
                status: 'merge_readiness_failed',
                error: diagnosticError(error),
                errorCode: errorCode(error),
                message: error instanceof Error ? error.message : String(error)
              })
            }
          }
        } catch (error) {
          record(runnerInput, 'scheduler', {
            status: 'review_aggregation_failed',
            error: diagnosticError(error),
            errorCode: errorCode(error),
            message: error instanceof Error ? error.message : String(error)
          })
        }
      }
    } else if (reviewPublication === 'superseded') {
      record(runnerInput, 'scheduler', {
        status: 'automatic_review_superseded',
        subjectAttemptId: prepared.task.reviewTask?.subject.attemptId
      })
    }
    if (prepared.task.mergeConflictTask) {
      recordCost(runnerInput, execution.usage)
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
      if (created) record(runnerInput, 'scheduler', { status: 'dynamic_tasks_created' })
    } catch (error) {
      record(runnerInput, 'scheduler', {
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
        record(runnerInput, 'scheduler', resolved)
      }
    } catch (error) {
      record(runnerInput, 'scheduler', {
        status: 'condition_advancement_failed',
        error: diagnosticError(error),
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
      if (created) record(runnerInput, 'scheduler', { status: 'review_panel_created' })
    } catch (error) {
      record(runnerInput, 'scheduler', {
        status: 'review_panel_advancement_failed',
        error: diagnosticError(error),
        errorCode: errorCode(error),
        message: error instanceof Error ? error.message : String(error)
      })
    }
    recordCost(runnerInput, execution.usage)
    recordPreparedAttemptDraftState({
      store: input.drafts,
      prepared,
      state: 'delivered',
      at: input.now()
    })
  } catch (error) {
    eventObserver.flush()
    let recoveryStatus: string
    try {
      recoveryStatus = prepared.task.mergeConflictTask
        ? recordAttemptInterruption({
            repository: input.repository,
            workflowRunId: prepared.workflowRunId,
            taskId: prepared.taskId,
            attemptId: prepared.attemptId,
            schedulerId: input.schedulerId,
            commandId: input.createId('command'),
            issuedAt: input.now(),
            ...(shouldAutomaticallyRetryAttempt({
              prepared,
              repository: input.repository,
              error,
              executorCompleted
            })
              ? { replacementAttemptId: input.createId('attempt') }
              : {})
          })
        : 'local_draft_retained'
    } catch (recoveryError) {
      recoveryStatus = `recovery_record_failed:${errorCode(recoveryError)}`
      record(runnerInput, 'scheduler', {
        status: 'recovery_record_failed',
        error: diagnosticError(recoveryError)
      })
    }
    record(runnerInput, 'executor', {
      status: 'execution_interrupted',
      error: diagnosticError(error),
      errorCode: errorCode(error),
      message: error instanceof Error ? error.message : String(error),
      recoveryStatus,
      worktreeRetained: existsSync(prepared.worktree.path)
    })
    recordPreparedAttemptDraftState({
      store: input.drafts,
      prepared,
      state: errorCode(error) === 'executor_timeout' ? 'waiting_for_resume' : 'needs_attention',
      at: input.now(),
      errorCode: errorCode(error)
    })
  }
}
