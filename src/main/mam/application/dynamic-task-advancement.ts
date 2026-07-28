import { ArtifactVersionSchema } from '../../../shared/mam/domain/artifact'
import { TaskPlanSchema } from '../../../shared/mam/domain/task-plan'
import type { SchedulerCommand } from '../../../shared/mam/scheduler-protocol'
import { GitCommandRetryCoordinator } from '../state-store/git-command-retry-coordinator'
import type { GitStateRepository } from '../state-store/git-state-repository'
import type { ValidatedAttemptArtifacts } from './attempt-artifact-validator'
import type { PreparedAttempt } from './mam-attempt-execution-types'

export function advanceDynamicTaskPlan(input: {
  prepared: PreparedAttempt
  validated: ValidatedAttemptArtifacts
  submittedCommit: string
  repository: GitStateRepository
  schedulerId: string
  commandId: string
  issuedAt: string
}): boolean {
  const bundle = input.repository.loadRunBundle(input.prepared.workflowRunId)
  const source = bundle?.taskCatalog.find((task) => task.id === input.prepared.taskId)
  if (!bundle || source?.nodeType !== 'dynamic_tasks') return false
  const node = bundle.definition.nodes.find(
    (candidate) => candidate.id === source.nodeId && candidate.type === 'dynamic_tasks'
  )
  if (!node || node.type !== 'dynamic_tasks') return false
  const record = input.validated.records.find(
    (candidate) => candidate.version.artifactType === node.planContract.artifactType
  )
  if (!record) throw new Error('task_plan_artifact_missing')
  const plan = TaskPlanSchema.parse(record.content)
  const planArtifact = ArtifactVersionSchema.parse({
    ...record.version,
    storageRef: `git:${input.submittedCommit}:${record.contentRef}`,
    availability: 'git'
  })
  const command: Extract<SchedulerCommand, { type: 'create_dynamic_tasks' }> = {
    schemaVersion: '1.0.0',
    commandId: input.commandId,
    issuedAt: input.issuedAt,
    workflowRunId: input.prepared.workflowRunId,
    taskId: input.prepared.taskId,
    actor: { kind: 'scheduler', schedulerId: input.schedulerId },
    type: 'create_dynamic_tasks',
    attemptId: input.prepared.attemptId,
    plan,
    planArtifact
  }
  new GitCommandRetryCoordinator(input.repository).executeAndPush({
    command,
    schedulerId: input.schedulerId
  })
  return true
}
