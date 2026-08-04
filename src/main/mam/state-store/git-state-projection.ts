import type { AttemptResult } from '../../../shared/mam/domain/attempt-result'
import type {
  ReviewAggregation,
  ReviewDecision,
  ReviewTaskDefinition
} from '../../../shared/mam/domain/review'
import type { ArtifactVersion } from '../../../shared/mam/domain/artifact'
import type { DynamicTaskDefinition, TaskPlan } from '../../../shared/mam/domain/task-plan'
import type { WorkflowRunBundle } from '../../../shared/mam/domain/run-bundle'
import type { ReviewSubject } from '../../../shared/mam/domain/review'
import type { MergeQueueEntry } from '../../../shared/mam/domain/merge-queue'
import type {
  MergeConflictResolution,
  MergeConflictTaskDefinition
} from '../../../shared/mam/domain/merge-conflict-task'
import { EMPTY_SCHEDULER_REVISION } from '../../../shared/mam/scheduler-protocol'
import type {
  SchedulerKernelContext,
  SchedulerTaskContext
} from '../scheduler/scheduler-command-authority'
import { withProjectionHash } from './git-state-stable-hash'
import type { ConditionProjection } from './condition-projection'
import type { SystemNodeExecutionProjection } from './system-node-execution-projection'
import { projectTaskAttemptCommandContext } from './task-attempt-command-context'

export type ProjectedTaskStatus = SchedulerTaskContext['status']

export type TaskProjection = Readonly<{
  status: ProjectedTaskStatus
  roleProfileId?: string
  roleProfileVersion?: number
  assignedByUserId?: string
  activeAttemptIds: readonly string[]
  knownAttemptIds: readonly string[]
  selectedAttemptId?: string
  reviewIds: readonly string[]
  executionWarnings: readonly Readonly<{
    attemptId: string
    concurrentAttemptIds: readonly string[]
    eventId: string
  }>[]
  submittedCommit?: string
  mergeReadyAt?: string
  dynamicTaskPlanHash?: string
  reviewPanelId?: string
  lastEventId: string
}>

export type AttemptProjection = Readonly<{
  taskId: string
  previousAttemptId?: string
  status:
    | 'recovery_planned'
    | 'announced'
    | 'running'
    | 'submitted'
    | 'blocked'
    | 'needs_reconciliation'
  executorInstanceId?: string
  roleInstanceId?: string
  executorInvocationId?: string
  effectiveConfigSnapshotId?: string
  effectiveConfigHash?: string
  result?: AttemptResult
  lastEventId: string
}>

export type WorkflowRunProjection = Readonly<{
  schemaVersion: '1.0.0'
  workflowRunId: string
  revision: string
  stateHash: string
  eventIds: readonly string[]
  commandIds: readonly string[]
  workflow?: Readonly<{
    definitionId: string
    definitionVersion: number
    planHash: string
    roleCatalogHash: string
  }>
  cancellation?: Readonly<{
    userId: string
    reason: string
    cancelledAt: string
    lastEventId: string
  }>
  tasks: Readonly<Record<string, TaskProjection>>
  attempts: Readonly<Record<string, AttemptProjection>>
  dynamicTaskPlans: Readonly<
    Record<
      string,
      Readonly<{
        plan: TaskPlan
        planArtifact: ArtifactVersion
        dynamicTaskIds: readonly string[]
      }>
    >
  >
  dynamicTasks: Readonly<Record<string, DynamicTaskDefinition>>
  reviews: Readonly<Record<string, ReviewDecision>>
  reviewAggregations: Readonly<Record<string, ReviewAggregation>>
  reviewPanels: Readonly<
    Record<
      string,
      Readonly<{
        reviewNodeId: string
        subject: ReviewSubject
        reviewTaskIds: readonly string[]
      }>
    >
  >
  reviewTasks: Readonly<Record<string, ReviewTaskDefinition>>
  reviewValidity: Readonly<
    Record<
      string,
      Readonly<{
        status: 'valid' | 'invalidated'
        invalidatedByAttemptId?: string
      }>
    >
  >
  mergeQueueEntries: Readonly<Record<string, MergeQueueEntry>>
  mergeConflictTasks: Readonly<Record<string, MergeConflictTaskDefinition>>
  mergeConflictResolutions: Readonly<Record<string, MergeConflictResolution>>
  resolvedApprovalGates: Readonly<
    Record<
      string,
      Readonly<{
        option: string
        userId: string
        commandId?: string
        resolvedAt?: string
      }>
    >
  >
  resolvedConditions: Readonly<Record<string, ConditionProjection>>
  systemNodeExecutions: SystemNodeExecutionProjection
  conflictResolutions: Readonly<
    Record<
      string,
      Readonly<{
        resolution: 'discard_pending_command' | 'accept_remote_state'
        rationale: string
        userId: string
      }>
    >
  >
  lastEventAt: string
}>

export function emptyWorkflowRunProjection(workflowRunId: string): WorkflowRunProjection {
  return withProjectionHash({
    schemaVersion: '1.0.0',
    workflowRunId,
    revision: EMPTY_SCHEDULER_REVISION,
    stateHash: '',
    eventIds: [],
    commandIds: [],
    tasks: {},
    attempts: {},
    dynamicTaskPlans: {},
    dynamicTasks: {},
    reviews: {},
    reviewAggregations: {},
    reviewPanels: {},
    reviewTasks: {},
    reviewValidity: {},
    mergeQueueEntries: {},
    mergeConflictTasks: {},
    mergeConflictResolutions: {},
    resolvedApprovalGates: {},
    resolvedConditions: {},
    systemNodeExecutions: {},
    conflictResolutions: {},
    lastEventAt: '1970-01-01T00:00:00.000Z'
  })
}

export function schedulerContextFromProjection(
  projection: WorkflowRunProjection,
  input: Readonly<{
    schedulerId: string
    taskId?: string
    validArtifactHashes?: ReadonlySet<string>
    approvalGates?: SchedulerKernelContext['approvalGates']
    taskDefinition?: Readonly<{
      initialStatus: 'waiting_dependencies' | 'waiting_role_assignment'
      allowedRoleProfileIds: readonly string[]
      roleCatalogVersions: ReadonlyMap<string, ReadonlySet<number>>
      reviewTarget?: ReviewSubject
      allowedReviewNodeIds?: readonly string[]
      minimumReviewDecisions?: number
      mergeCandidate?: MergeQueueEntry
      mergeResolutionCandidate?: MergeConflictResolution
    }>
    runBundle?: WorkflowRunBundle
  }>
): SchedulerKernelContext {
  const projectedTask = input.taskId ? projection.tasks[input.taskId] : undefined
  const task =
    input.taskId && (projectedTask || input.taskDefinition)
      ? toTaskContext(
          projection.workflowRunId,
          input.taskId,
          projectedTask,
          projection.attempts,
          projection.reviews,
          projection.reviewValidity,
          input.taskDefinition
        )
      : undefined
  return {
    schedulerId: input.schedulerId,
    runCancelled: Boolean(projection.cancellation),
    hasActiveAttempts: Object.values(projection.attempts).some(
      (attempt) => attempt.status === 'announced' || attempt.status === 'running'
    ),
    ...(task ? { task } : {}),
    ...(input.approvalGates ? { approvalGates: input.approvalGates } : {}),
    validArtifactHashes: input.validArtifactHashes ?? new Set(),
    processedCommandIds: new Set(projection.commandIds),
    mergeQueueEntries: new Map(Object.entries(projection.mergeQueueEntries)),
    ...(input.runBundle ? { runBundle: input.runBundle } : {}),
    existingTaskIds: new Set([
      ...Object.keys(projection.tasks),
      ...Object.keys(projection.dynamicTasks),
      ...Object.keys(projection.reviewTasks),
      ...Object.keys(projection.mergeConflictTasks),
      ...(input.runBundle?.taskCatalog.map((task) => task.id) ?? [])
    ]),
    revision: projection.revision
  }
}

export function listTasksForRole(
  projection: WorkflowRunProjection,
  roleProfileId: string
): readonly Readonly<{ taskId: string; task: TaskProjection }>[] {
  return Object.entries(projection.tasks)
    .filter(([, task]) => task.roleProfileId === roleProfileId)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([taskId, task]) => ({ taskId, task }))
}

function toTaskContext(
  workflowRunId: string,
  taskId: string,
  task: TaskProjection | undefined,
  attempts: WorkflowRunProjection['attempts'],
  reviews: WorkflowRunProjection['reviews'],
  reviewValidity: WorkflowRunProjection['reviewValidity'],
  definition?: Readonly<{
    initialStatus: 'waiting_dependencies' | 'waiting_role_assignment'
    allowedRoleProfileIds: readonly string[]
    roleCatalogVersions: ReadonlyMap<string, ReadonlySet<number>>
    reviewTarget?: ReviewSubject
    allowedReviewNodeIds?: readonly string[]
    minimumReviewDecisions?: number
    mergeCandidate?: MergeQueueEntry
    mergeResolutionCandidate?: MergeConflictResolution
  }>
): SchedulerTaskContext {
  const attemptContext = projectTaskAttemptCommandContext(task, attempts)
  const reviewDecisions = new Map(
    (task?.reviewIds ?? []).flatMap((reviewId) => {
      const review = reviews[reviewId]
      return review && reviewValidity[reviewId]?.status === 'valid'
        ? [[reviewId, review] as const]
        : []
    })
  )
  return {
    workflowRunId,
    taskId,
    status: task?.status ?? definition?.initialStatus ?? 'waiting_dependencies',
    ...(task?.roleProfileId ? { assignedRoleProfileId: task.roleProfileId } : {}),
    ...(task?.roleProfileVersion ? { assignedRoleProfileVersion: task.roleProfileVersion } : {}),
    ...attemptContext,
    allowedRoleProfileIds: new Set(definition?.allowedRoleProfileIds ?? []),
    roleCatalogVersions:
      definition?.roleCatalogVersions ??
      new Map(
        task?.roleProfileId && task.roleProfileVersion
          ? [[task.roleProfileId, new Set([task.roleProfileVersion])]]
          : []
      ),
    ...(task?.dynamicTaskPlanHash ? { dynamicTaskPlanHash: task.dynamicTaskPlanHash } : {}),
    ...(task?.reviewPanelId ? { reviewPanelId: task.reviewPanelId } : {}),
    ...(definition?.reviewTarget ? { reviewTarget: definition.reviewTarget } : {}),
    ...(definition?.allowedReviewNodeIds
      ? { allowedReviewNodeIds: new Set(definition.allowedReviewNodeIds) }
      : {}),
    reviewDecisions,
    ...(definition?.minimumReviewDecisions
      ? { minimumReviewDecisions: definition.minimumReviewDecisions }
      : {}),
    ...(definition?.mergeCandidate ? { mergeCandidate: definition.mergeCandidate } : {}),
    ...(definition?.mergeResolutionCandidate
      ? { mergeResolutionCandidate: definition.mergeResolutionCandidate }
      : {})
  }
}
