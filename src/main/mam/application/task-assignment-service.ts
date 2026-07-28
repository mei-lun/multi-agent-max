import {
  AttemptSchema,
  ExecutionClaimNoticeSchema,
  TaskAssignmentSchema,
  TaskSchema,
  type Attempt,
  type Task,
  type TaskAssignment
} from '../../../shared/mam/domain/task'

export type RunRoleCatalogEntry = Readonly<{
  roleProfileId: string
  roleProfileVersion: number
}>

export type AttemptStartInput = Readonly<{
  attemptId: string
  executorInstanceId: string
  effectiveConfigSnapshotId: string
  effectiveConfigHash: string
  announcedAt: string
  revision: string
}>

export type AttemptStartResult = Readonly<{
  task: Task
  attempt: Attempt
  warning?: Readonly<{
    code: 'concurrent_execution_warning'
    activeAttemptIds: readonly string[]
  }>
}>

export class TaskAssignmentError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message)
    this.name = 'TaskAssignmentError'
  }
}

export function assignTask(
  taskInput: Task,
  assignmentInput: TaskAssignment,
  roleCatalog: readonly RunRoleCatalogEntry[]
): Task {
  const task = TaskSchema.parse(taskInput)
  const assignment = TaskAssignmentSchema.parse(assignmentInput)
  if (task.assignment) {
    throw new TaskAssignmentError('task_already_assigned', 'task already has a Role Assignment')
  }
  if (assignment.taskId !== task.id) {
    throw new TaskAssignmentError('assignment_task_mismatch', 'assignment targets another task')
  }
  if (
    task.allowedRoleProfileIds.length > 0 &&
    !task.allowedRoleProfileIds.includes(assignment.roleProfileId)
  ) {
    throw new TaskAssignmentError('role_not_allowed', 'role is outside the task allowlist')
  }
  const catalogEntry = roleCatalog.find(
    (entry) =>
      entry.roleProfileId === assignment.roleProfileId &&
      entry.roleProfileVersion === assignment.roleProfileVersion
  )
  if (!catalogEntry) {
    throw new TaskAssignmentError('role_not_in_run_catalog', 'role version is not available in run')
  }
  return TaskSchema.parse({ ...task, assignment, status: 'ready' })
}

export function startAttempt(taskInput: Task, input: AttemptStartInput): AttemptStartResult {
  const task = TaskSchema.parse(taskInput)
  if (!task.assignment) {
    throw new TaskAssignmentError('assignment_required', 'user Role Assignment is required')
  }
  const activeAttemptIds = task.executionNotices
    .filter((notice) => notice.releasedAt === undefined)
    .map((notice) => notice.attemptId)
  const previousAttemptId = task.attemptIds.at(-1)
  const attempt = AttemptSchema.parse({
    schemaVersion: '1.0.0',
    id: input.attemptId,
    taskId: task.id,
    number: task.attemptIds.length + 1,
    ...(previousAttemptId ? { previousAttemptId } : {}),
    effectiveConfigSnapshotId: input.effectiveConfigSnapshotId,
    effectiveConfigHash: input.effectiveConfigHash,
    status: 'created',
    outputArtifacts: [],
    createdAt: input.announcedAt
  })
  const notice = ExecutionClaimNoticeSchema.parse({
    claimId: `claim.${input.attemptId}`,
    workflowRunId: task.workflowRunId,
    taskId: task.id,
    roleProfileId: task.assignment.roleProfileId,
    executorInstanceId: input.executorInstanceId,
    attemptId: attempt.id,
    announcedAt: input.announcedAt,
    lastObservedAt: input.announcedAt,
    revision: input.revision
  })
  const updated = TaskSchema.parse({
    ...task,
    status: 'running',
    attemptIds: [...task.attemptIds, attempt.id],
    selectedAttemptId: task.selectedAttemptId ?? attempt.id,
    executionNotices: [...task.executionNotices, notice]
  })
  return {
    task: updated,
    attempt,
    ...(activeAttemptIds.length > 0
      ? { warning: { code: 'concurrent_execution_warning' as const, activeAttemptIds } }
      : {})
  }
}

export function selectAttempt(taskInput: Task, attemptId: string): Task {
  const task = TaskSchema.parse(taskInput)
  if (!task.attemptIds.includes(attemptId)) {
    throw new TaskAssignmentError('attempt_not_found', 'attempt does not belong to task')
  }
  return TaskSchema.parse({ ...task, selectedAttemptId: attemptId })
}
