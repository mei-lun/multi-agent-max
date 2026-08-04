import type { SchedulerCommand } from '../../../shared/mam/scheduler-protocol'
import type { EffectiveRoleConfigSnapshot } from '../../../shared/mam/domain/role'
import type { WorkflowRunBundle } from '../../../shared/mam/domain/run-bundle'
import {
  SchedulerCommandRejectedError,
  SchedulerKernel,
  type KernelEventBatch
} from '../scheduler/kernel'
import type { SchedulerKernelContext } from '../scheduler/scheduler-command-authority'
import { schedulerContextFromProjection, type WorkflowRunProjection } from './git-event-projection'
import {
  GitStateRepositoryError,
  type GitStateAppendResult,
  type GitSystemArtifactWrite,
  type GitStateRepository
} from './git-state-repository'
import type { GitCommandConflictStore } from './git-command-conflict-store'
import { projectWorkflowRun, taskContextDefinition } from '../application/workflow-run-projection'
import { reviewDisagreementGateId } from '../application/review-disagreement-resolution'
import { createMergeQueueEntry } from '../application/merge-queue-service'

export type GitCommandExecutionInput = Readonly<{
  command: SchedulerCommand
  schedulerId: string
  validArtifactHashes?: ReadonlySet<string>
  approvalGates?: SchedulerKernelContext['approvalGates']
  effectiveConfigSnapshot?: EffectiveRoleConfigSnapshot
  runBundle?: WorkflowRunBundle
  systemArtifactWrites?: readonly GitSystemArtifactWrite[]
  maxAttempts?: number
}>

export type PreparedGitCommand = Readonly<{
  input: GitCommandExecutionInput
  projection: WorkflowRunProjection
  batch: KernelEventBatch
  parentCommit: string
}>

export type GitCommandExecutionResult = GitStateAppendResult &
  Readonly<{
    retryCount: number
    projection: WorkflowRunProjection
  }>

export class GitCommandConflictPendingError extends Error {
  constructor(readonly conflictId: string) {
    super(`Git command requires user resolution: ${conflictId}`)
    this.name = 'GitCommandConflictPendingError'
  }
}

export class GitCommandRetryCoordinator {
  constructor(
    private readonly repository: GitStateRepository,
    private readonly kernel = new SchedulerKernel(),
    private readonly conflictStore?: GitCommandConflictStore
  ) {}

  prepare(input: GitCommandExecutionInput): PreparedGitCommand {
    this.repository.alignToRemote()
    return this.generate(input)
  }

  executeAndPush(input: GitCommandExecutionInput): GitCommandExecutionResult {
    return this.publish(this.prepare(input))
  }

  publish(prepared: PreparedGitCommand): GitCommandExecutionResult {
    const maxAttempts = prepared.input.maxAttempts ?? 3
    let current = prepared
    for (let attemptNumber = 1; attemptNumber <= maxAttempts; attemptNumber++) {
      try {
        const appended = this.repository.appendCommitAndPush({
          workflowRunId: current.input.command.workflowRunId,
          batch: current.batch,
          expectedRevision: current.projection.revision,
          expectedParentCommit: current.parentCommit,
          ...(current.input.effectiveConfigSnapshot
            ? { effectiveConfigSnapshot: current.input.effectiveConfigSnapshot }
            : {}),
          ...(current.input.runBundle ? { runBundle: current.input.runBundle } : {}),
          ...(current.input.systemArtifactWrites
            ? { systemArtifactWrites: current.input.systemArtifactWrites }
            : {})
        })
        return {
          ...appended,
          retryCount: attemptNumber - 1,
          projection:
            current.batch.events.length === 0
              ? current.projection
              : this.repository.rebuild(current.input.command.workflowRunId)
        }
      } catch (error) {
        if (
          !(error instanceof GitStateRepositoryError) ||
          !['remote_non_fast_forward', 'local_non_fast_forward'].includes(error.code) ||
          attemptNumber === maxAttempts
        ) {
          throw error
        }
        // The stale event is abandoned; the original command is regenerated after replay.
        this.repository.alignToRemote()
        try {
          current = this.generate(current.input)
        } catch (regenerationError) {
          if (
            !(regenerationError instanceof SchedulerCommandRejectedError) ||
            !this.conflictStore
          ) {
            throw regenerationError
          }
          const latest = this.repository.rebuild(current.input.command.workflowRunId)
          const conflict = this.conflictStore.record({
            command: current.input.command,
            baseRevision: current.projection.revision,
            latestRevision: latest.revision,
            latestCommit: this.repository.currentCommit(),
            failureCode: regenerationError.code,
            failureMessage: regenerationError.message
          })
          throw new GitCommandConflictPendingError(conflict.conflictId)
        }
      }
    }
    throw new GitStateRepositoryError('retry_exhausted', 'Git command retry was exhausted')
  }

  resolveConflict(
    command: Extract<SchedulerCommand, { type: 'resolve_state_conflict' }>,
    schedulerId: string
  ): GitCommandExecutionResult {
    if (!this.conflictStore) {
      throw new Error('Git command conflict store is not configured')
    }
    if (command.actor.kind !== 'user') {
      throw new Error('state conflict resolution requires a user command')
    }
    this.conflictStore.requirePending(command.conflictId)
    const result = this.executeAndPush({ command, schedulerId })
    this.conflictStore.consume(command.conflictId, {
      resolutionCommandId: command.commandId,
      resolvedByUserId: command.actor.userId
    })
    return result
  }

  private generate(input: GitCommandExecutionInput): PreparedGitCommand {
    const projection = this.repository.rebuild(input.command.workflowRunId)
    const storedBundle = this.repository.loadRunBundle(input.command.workflowRunId)
    const bundle = storedBundle ?? input.runBundle
    if (input.command.type === 'create_workflow_run' && !input.runBundle) {
      throw new GitStateRepositoryError(
        'run_bundle_required',
        'create_workflow_run requires an authoritative Run Bundle'
      )
    }
    if (input.command.type !== 'create_workflow_run' && !storedBundle) {
      throw new GitStateRepositoryError(
        'run_bundle_required',
        'Scheduler command targets a Run without an authoritative Run Bundle'
      )
    }
    let taskDefinition =
      bundle && 'taskId' in input.command
        ? taskContextDefinition(bundle, projection, input.command.taskId)
        : undefined
    if (bundle && taskDefinition && input.command.type === 'mark_merge_ready') {
      taskDefinition = {
        ...taskDefinition,
        mergeCandidate: createMergeQueueEntry({
          bundle,
          projection,
          mergeNodeId: input.command.entry.mergeNodeId,
          taskId: input.command.taskId,
          sourceBranch: input.command.entry.sourceBranch,
          mergeReadyAt: input.command.entry.mergeReadyAt,
          validationEvidence: input.command.entry.validationEvidence
        })
      }
    }
    if (taskDefinition && input.command.type === 'record_merge_conflict_resolution') {
      taskDefinition = {
        ...taskDefinition,
        mergeResolutionCandidate: input.command.resolution
      }
    }
    const approvalGates = bundle
      ? new Map([
          ...bundle.definition.nodes
            .filter((node) => node.type === 'approval_gate')
            .map(
              (node) =>
                [
                  node.id,
                  {
                    status: projection.resolvedApprovalGates[node.id]
                      ? ('resolved' as const)
                      : ('pending' as const),
                    options: new Set(node.options)
                  }
                ] as const
            ),
          ...Object.values(projection.reviewAggregations)
            .filter((aggregation) => aggregation.requiresHumanDecision)
            .map((aggregation) => {
              const gateId = reviewDisagreementGateId(aggregation.id)
              return [
                gateId,
                {
                  status: projection.resolvedApprovalGates[gateId]
                    ? ('resolved' as const)
                    : ('pending' as const),
                  options: new Set(['approved', 'changes_requested', 'blocked'])
                }
              ] as const
            })
        ])
      : undefined
    const baseContext = schedulerContextFromProjection(projection, {
      schedulerId: input.schedulerId,
      ...('taskId' in input.command ? { taskId: input.command.taskId } : {}),
      ...(input.validArtifactHashes ? { validArtifactHashes: input.validArtifactHashes } : {}),
      ...(approvalGates ? { approvalGates } : {}),
      ...(taskDefinition ? { taskDefinition } : {}),
      ...(bundle ? { runBundle: bundle } : {})
    })
    const context = bundle
      ? {
          ...baseContext,
          resolvedConditionNodeIds: new Set(Object.keys(projection.resolvedConditions)),
          completedSystemNodeIds: new Set(Object.keys(projection.systemNodeExecutions)),
          nodeStatuses: new Map(
            projectWorkflowRun(bundle, projection, input.command.issuedAt).nodeRuns.map((node) => [
              node.nodeId,
              node.status
            ])
          )
        }
      : baseContext
    return {
      input,
      projection,
      batch: this.kernel.execute(input.command, context),
      parentCommit: this.repository.currentCommit()
    }
  }
}
