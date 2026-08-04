import { z } from 'zod'
import { AttemptResultSchema } from './domain/attempt-result'
import {
  IsoTimestampSchema,
  MamEntityIdSchema,
  MamSchemaVersionSchema,
  Sha256Schema
} from './domain/primitives'
import { ReviewAggregationSchema, ReviewDecisionSchema } from './domain/review'
import { ReviewSubjectSchema, ReviewTaskDefinitionSchema } from './domain/review'
import { ArtifactVersionSchema } from './domain/artifact'
import { DynamicTaskDefinitionSchema, TaskPlanSchema } from './domain/task-plan'
import { MergeOutcomeSchema, MergeQueueEntrySchema } from './domain/merge-queue'
import { createMergeQueueCommandSchemas } from './merge-queue-scheduler-command'
import { MergeConflictResolutionSchema } from './domain/merge-conflict-task'
import * as conditionProtocol from './condition-scheduler-protocol'
import * as systemNodeProtocol from './system-node-scheduler-protocol'
import {
  createTaskAssignmentCommandSchemas,
  createTaskAssignmentEventSchemas
} from './task-assignment-scheduler-protocol'
import {
  createWorkflowRunLifecycleCommandSchemas,
  createWorkflowRunLifecycleEventSchemas
} from './workflow-run-lifecycle-scheduler-protocol'

export const EMPTY_SCHEDULER_REVISION =
  '4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945'

const userActor = z.object({ kind: z.literal('user'), userId: MamEntityIdSchema }).strict()
const schedulerActor = z
  .object({ kind: z.literal('scheduler'), schedulerId: MamEntityIdSchema })
  .strict()
const executorActor = z
  .object({
    kind: z.literal('executor'),
    roleInstanceId: MamEntityIdSchema,
    attemptId: MamEntityIdSchema,
    executorInvocationId: MamEntityIdSchema
  })
  .strict()

export const SchedulerActorSchema = z.discriminatedUnion('kind', [
  userActor,
  schedulerActor,
  executorActor
])

const commandEnvelope = {
  schemaVersion: MamSchemaVersionSchema,
  commandId: MamEntityIdSchema,
  issuedAt: IsoTimestampSchema,
  workflowRunId: MamEntityIdSchema,
  actor: SchedulerActorSchema
}

const taskCommandEnvelope = { ...commandEnvelope, taskId: MamEntityIdSchema }
const mergeQueueCommands = createMergeQueueCommandSchemas(commandEnvelope, taskCommandEnvelope)
const taskAssignmentCommands = createTaskAssignmentCommandSchemas(taskCommandEnvelope)
const workflowRunLifecycleCommands = createWorkflowRunLifecycleCommandSchemas(commandEnvelope)

const AttemptRecoveryDirectiveSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('start_new_attempt'), newAttemptId: MamEntityIdSchema }).strict(),
  z.object({ kind: z.literal('needs_reconciliation') }).strict()
])

export const SchedulerCommandSchema = z.discriminatedUnion('type', [
  ...workflowRunLifecycleCommands,
  ...taskAssignmentCommands,
  z
    .object({
      ...taskCommandEnvelope,
      type: z.literal('announce_execution'),
      claimId: MamEntityIdSchema,
      attemptId: MamEntityIdSchema,
      previousAttemptId: MamEntityIdSchema.optional(),
      executorInstanceId: MamEntityIdSchema
    })
    .strict(),
  z
    .object({
      ...taskCommandEnvelope,
      type: z.literal('start_attempt'),
      attemptId: MamEntityIdSchema,
      roleInstanceId: MamEntityIdSchema,
      executorInvocationId: MamEntityIdSchema,
      effectiveConfigSnapshotId: MamEntityIdSchema,
      effectiveConfigHash: Sha256Schema
    })
    .strict(),
  z
    .object({
      ...taskCommandEnvelope,
      type: z.literal('recover_attempt'),
      previousAttemptId: MamEntityIdSchema,
      directive: AttemptRecoveryDirectiveSchema,
      reason: z.string().min(1).max(4000)
    })
    .strict(),
  z
    .object({
      ...taskCommandEnvelope,
      type: z.literal('submit_attempt_result'),
      attemptId: MamEntityIdSchema,
      result: AttemptResultSchema
    })
    .strict(),
  z
    .object({
      ...taskCommandEnvelope,
      type: z.literal('create_dynamic_tasks'),
      attemptId: MamEntityIdSchema,
      plan: TaskPlanSchema,
      planArtifact: ArtifactVersionSchema
    })
    .strict(),
  z
    .object({
      ...taskCommandEnvelope,
      type: z.literal('record_review'),
      attemptId: MamEntityIdSchema,
      review: ReviewDecisionSchema
    })
    .strict(),
  z
    .object({
      ...taskCommandEnvelope,
      type: z.literal('record_review_aggregation'),
      aggregation: ReviewAggregationSchema
    })
    .strict(),
  z
    .object({
      ...taskCommandEnvelope,
      type: z.literal('create_review_panel'),
      reviewNodeId: MamEntityIdSchema,
      subject: ReviewSubjectSchema
    })
    .strict(),
  z
    .object({
      ...taskCommandEnvelope,
      type: z.literal('select_attempt'),
      attemptId: MamEntityIdSchema
    })
    .strict(),
  z
    .object({
      ...taskCommandEnvelope,
      type: z.literal('report_progress'),
      attemptId: MamEntityIdSchema,
      message: z.string().min(1).max(4000),
      percent: z.number().min(0).max(100).optional()
    })
    .strict(),
  z
    .object({
      ...commandEnvelope,
      type: z.literal('resolve_approval_gate'),
      gateId: MamEntityIdSchema,
      option: z.string().min(1).max(1000)
    })
    .strict(),
  conditionProtocol.createConditionCommandSchema(commandEnvelope),
  systemNodeProtocol.createSystemNodeCommandSchema(commandEnvelope),
  z
    .object({
      ...commandEnvelope,
      type: z.literal('resolve_state_conflict'),
      conflictId: MamEntityIdSchema,
      resolution: z.enum(['discard_pending_command', 'accept_remote_state']),
      rationale: z.string().min(1).max(4000)
    })
    .strict(),
  ...mergeQueueCommands
])

const eventEnvelope = {
  schemaVersion: MamSchemaVersionSchema,
  eventId: MamEntityIdSchema,
  commandId: MamEntityIdSchema,
  createdAt: IsoTimestampSchema,
  workflowRunId: MamEntityIdSchema,
  schedulerId: MamEntityIdSchema,
  parentRevision: Sha256Schema
}

function event<T extends string, S extends z.ZodRawShape>(type: T, fields: S) {
  return z.object({ ...eventEnvelope, type: z.literal(type), ...fields }).strict()
}

export const SchedulerEventSchema = z.discriminatedUnion('type', [
  ...createWorkflowRunLifecycleEventSchemas(eventEnvelope),
  ...createTaskAssignmentEventSchemas(eventEnvelope),
  event('execution_announced', {
    taskId: MamEntityIdSchema,
    claimId: MamEntityIdSchema,
    attemptId: MamEntityIdSchema,
    previousAttemptId: MamEntityIdSchema.optional(),
    executorInstanceId: MamEntityIdSchema,
    concurrentAttemptIds: z.array(MamEntityIdSchema)
  }),
  event('attempt_started', {
    taskId: MamEntityIdSchema,
    attemptId: MamEntityIdSchema,
    roleInstanceId: MamEntityIdSchema,
    executorInvocationId: MamEntityIdSchema,
    effectiveConfigSnapshotId: MamEntityIdSchema,
    effectiveConfigHash: Sha256Schema
  }),
  event('attempt_recovery_recorded', {
    taskId: MamEntityIdSchema,
    previousAttemptId: MamEntityIdSchema,
    directive: AttemptRecoveryDirectiveSchema,
    reason: z.string().min(1).max(4000),
    recoveredByUserId: MamEntityIdSchema.optional()
  }),
  event('attempt_result_submitted', {
    taskId: MamEntityIdSchema,
    attemptId: MamEntityIdSchema,
    result: AttemptResultSchema
  }),
  event('dynamic_tasks_created', {
    taskId: MamEntityIdSchema,
    attemptId: MamEntityIdSchema,
    plan: TaskPlanSchema,
    planArtifact: ArtifactVersionSchema,
    dynamicTasks: z.array(DynamicTaskDefinitionSchema).min(1)
  }),
  event('review_recorded', {
    taskId: MamEntityIdSchema,
    attemptId: MamEntityIdSchema,
    review: ReviewDecisionSchema
  }),
  event('review_aggregation_recorded', {
    taskId: MamEntityIdSchema,
    aggregation: ReviewAggregationSchema
  }),
  event('review_panel_created', {
    taskId: MamEntityIdSchema,
    reviewNodeId: MamEntityIdSchema,
    subject: ReviewSubjectSchema,
    reviewTasks: z.array(ReviewTaskDefinitionSchema).min(1)
  }),
  event('attempt_selected', {
    taskId: MamEntityIdSchema,
    attemptId: MamEntityIdSchema,
    selectedByUserId: MamEntityIdSchema
  }),
  event('progress_reported', {
    taskId: MamEntityIdSchema,
    attemptId: MamEntityIdSchema,
    message: z.string().min(1),
    percent: z.number().min(0).max(100).optional()
  }),
  event('approval_gate_resolved', {
    gateId: MamEntityIdSchema,
    userId: MamEntityIdSchema,
    option: z.string().min(1)
  }),
  conditionProtocol.createConditionEventSchema(eventEnvelope),
  systemNodeProtocol.createSystemNodeEventSchema(eventEnvelope),
  event('state_conflict_resolved', {
    conflictId: MamEntityIdSchema,
    userId: MamEntityIdSchema,
    resolution: z.enum(['discard_pending_command', 'accept_remote_state']),
    rationale: z.string().min(1).max(4000)
  }),
  event('merge_ready_recorded', {
    taskId: MamEntityIdSchema,
    entry: MergeQueueEntrySchema
  }),
  event('merge_entry_claimed', {
    entryId: MamEntityIdSchema,
    claimedAt: IsoTimestampSchema
  }),
  event('merge_outcome_recorded', {
    entryId: MamEntityIdSchema,
    outcome: MergeOutcomeSchema
  }),
  event('merge_conflict_resolution_recorded', {
    taskId: MamEntityIdSchema,
    attemptId: MamEntityIdSchema,
    resolution: MergeConflictResolutionSchema
  }),
  event('merge_entry_superseded', {
    entryId: MamEntityIdSchema,
    replacementCommit: z.string().min(7),
    supersededAt: IsoTimestampSchema
  })
])

export type SchedulerActor = z.infer<typeof SchedulerActorSchema>
export type SchedulerCommand = z.infer<typeof SchedulerCommandSchema>
export type SchedulerEvent = z.infer<typeof SchedulerEventSchema>
