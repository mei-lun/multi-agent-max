import { AttemptResultSchema, type AttemptResult } from '../../../shared/mam/domain/attempt-result'
import { existsSync } from 'node:fs'
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
import { AttemptResourceApplicationService } from './attempt-resource-application-service'
import { ExecutorCapabilityBridge } from './executor-capability-bridge'
import { McpSdkConnector } from '../gateways/mcp-sdk-connector'
import { FileKnowledgeConnector } from '../gateways/file-knowledge-connector'
import { recordAttemptInterruption } from './attempt-interruption-recovery'
import { materializeDirectAttemptResult } from './direct-attempt-result'
import { collectPreparedAttemptResult } from './prepared-attempt-result-collector'
import {
  automaticReviewSubmission,
  publishAutomaticReviewSubmission
} from './automatic-review-submission'
import { shouldAutomaticallyRetryAttempt } from './attempt-automatic-retry'
import { buildAttemptResultCommand } from './attempt-result-command'
import { normalizePreparedReviewContracts } from './automatic-review-contract'
import { AttemptExecutorEventObserver } from './attempt-executor-event-observer'
import {
  attemptRunnerErrorCode as errorCode,
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
}>

export async function runPreparedAttempt(input: PreparedAttemptRunnerInput): Promise<void> {
  const prepared = normalizePreparedReviewContracts(input.prepared)
  const eventObserver = new AttemptExecutorEventObserver(input)
  let executorCompleted = false
  try {
    const authority = attemptGatewayAuthority(prepared)
    const resourceApplication = new AttemptResourceApplicationService(
      prepared.resolvedConfig,
      authority,
      new McpSdkConnector((connectionRef) =>
        prepared.mcpConnections.find((connection) => connection.connectionRef === connectionRef)
      ),
      new FileKnowledgeConnector(input.repository.projectDirectory),
      input.diagnostics
    )
    const capabilityBridge = new ExecutorCapabilityBridge(
      resourceApplication,
      gatewayRequestContext(authority)
    )
    const execution = await input.executor
      .execute({
        profile: prepared.profile,
        binding: prepared.binding,
        snapshot: prepared.snapshot,
        resources: prepared.resources,
        executorInvocationId: prepared.executorInvocationId,
        workspacePath: prepared.worktree.path,
        systemPrompt: prepared.systemPrompt,
        prompt: prepared.prompt,
        credentialValues: prepared.credentialValues,
        authority: attemptAuthority(prepared, input.now()),
        capabilityBridge,
        onEvent: eventObserver.observe
      })
      .finally(() => resourceApplication.dispose())
    executorCompleted = true
    eventObserver.recordReturned(execution.events)
    const collected = execution.result
      ? undefined
      : await collectPreparedAttemptResult({
          prepared,
          assistantText: execution.assistantText,
          usage: execution.usage,
          git: input.git,
          authority: attemptAuthority(prepared, input.now())
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
      : finalizeRegularAttempt(input, validated.result, validated.validHashes)
    record(input, 'executor', {
      status: 'result_submitted',
      submittedCommit: authoritative.system.submittedCommit
    })
    if (
      publishAutomaticReviewSubmission({
        request: automaticReview,
        repository: input.repository,
        schedulerId: input.schedulerId,
        nextCommandId: () => input.createId('command'),
        now: input.now
      })
    ) {
      record(input, 'scheduler', { status: 'automatic_review_submitted' })
    }
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
    eventObserver.flush()
    let recoveryStatus: string
    try {
      recoveryStatus = recordAttemptInterruption({
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
    } catch (recoveryError) {
      recoveryStatus = `recovery_record_failed:${errorCode(recoveryError)}`
    }
    record(input, 'executor', {
      status: 'execution_interrupted',
      errorCode: errorCode(error),
      message: error instanceof Error ? error.message : String(error),
      recoveryStatus,
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
    command: buildAttemptResultCommand(
      input.prepared,
      authoritative,
      input.createId('command'),
      input.now()
    ),
    schedulerId: input.schedulerId,
    validArtifactHashes
  })
  return authoritative
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

function attemptGatewayAuthority(prepared: PreparedAttempt) {
  return {
    workflowRunId: prepared.workflowRunId,
    nodeRunId: prepared.task.nodeRunId,
    taskId: prepared.taskId,
    attemptId: prepared.attemptId,
    roleInstanceId: prepared.roleInstanceId,
    executorInvocationId: prepared.executorInvocationId,
    effectiveConfigHash: prepared.snapshot.contentHash
  }
}

function gatewayRequestContext(authority: ReturnType<typeof attemptGatewayAuthority>) {
  const { nodeRunId: _, ...context } = authority
  return context
}
