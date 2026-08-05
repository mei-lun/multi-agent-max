import type { WorkflowRunBundle } from '../../../shared/mam/domain/run-bundle'
import type { GitStateRepository } from '../state-store/git-state-repository'
import type { WorkflowRunProjection } from '../state-store/git-state-projection'
import { projectWorkflowRun } from './workflow-run-projection'
import type { MamAttemptExecutionService } from './mam-attempt-execution-service'
import type { MamUiCommandService } from './mam-ui-command-service'

/** Starts fixed-role Tasks whenever the projected workflow makes them executable. */
export class MamAutomaticWorkflowRunner {
  private repository: GitStateRepository | undefined
  private scheduled = false
  private running = false

  constructor(
    private readonly attempts: MamAttemptExecutionService,
    private readonly commands: MamUiCommandService,
    private readonly now: () => string = () => new Date().toISOString()
  ) {}

  setRepository(repository: GitStateRepository): void {
    this.repository = repository
  }

  notify(): void {
    if (this.scheduled) return
    this.scheduled = true
    setImmediate(() => {
      this.scheduled = false
      void this.drain()
    })
  }

  private async drain(): Promise<void> {
    if (this.running || !this.repository) return
    this.running = true
    try {
      for (;;) {
        const next = this.nextCandidate()
        if (!next) return
        try {
          await this.start(next)
        } catch {
          // Preflight, resource and recovery failures are visible in the normal UI snapshot.
          // Do not spin on a task that cannot currently start.
          return
        }
      }
    } finally {
      this.running = false
    }
  }

  private nextCandidate(): AutomaticTask | undefined {
    const repository = this.repository
    if (!repository) return undefined
    for (const workflowRunId of [...repository.listWorkflowRunIds()].sort()) {
      const bundle = repository.loadRunBundle(workflowRunId)
      if (!bundle) continue
      const projection = repository.rebuild(workflowRunId)
      const application = projectWorkflowRun(bundle, projection, this.now())
      const taskIds = [...executableTaskIds(bundle, projection)].sort()
      for (const taskId of taskIds) {
        const task = projection.tasks[taskId]
        if (task?.activeAttemptIds.length) continue
        const projectedStatus =
          task?.status ?? (application.readyTaskIds.includes(taskId) ? 'ready' : undefined)
        if (projectedStatus !== 'ready' && projectedStatus !== 'changes_requested') continue
        const definition = taskDefinition(bundle, projection, taskId)
        if (!definition || definition.allowedRoleProfileIds.length !== 1) continue
        return {
          workflowRunId,
          taskId,
          roleProfileId: definition.allowedRoleProfileIds[0]!,
          roleProfileVersion: roleVersion(bundle, definition.allowedRoleProfileIds[0]!)
        }
      }
    }
    return undefined
  }

  private async start(candidate: AutomaticTask): Promise<void> {
    const repository = this.repository
    if (!repository) return
    const projection = repository.rebuild(candidate.workflowRunId)
    const task = projection.tasks[candidate.taskId]
    if (!task?.roleProfileId) {
      this.commands.assignTask({
        workflowRunId: candidate.workflowRunId,
        taskId: candidate.taskId,
        roleProfileId: candidate.roleProfileId,
        roleProfileVersion: candidate.roleProfileVersion
      })
    }
    await this.attempts.start({
      workflowRunId: candidate.workflowRunId,
      taskId: candidate.taskId
    })
  }
}

type AutomaticTask = Readonly<{
  workflowRunId: string
  taskId: string
  roleProfileId: string
  roleProfileVersion: number
}>

type RoleBoundTask = Readonly<{
  id: string
  allowedRoleProfileIds: readonly string[]
}>

function executableTaskIds(
  bundle: WorkflowRunBundle,
  projection: WorkflowRunProjection
): readonly string[] {
  return [
    ...bundle.taskCatalog.filter((task) => task.nodeType !== 'git_merge').map((task) => task.id),
    ...Object.keys(projection.reviewTasks),
    ...Object.keys(projection.dynamicTasks)
  ]
}

function taskDefinition(
  bundle: WorkflowRunBundle,
  projection: WorkflowRunProjection,
  taskId: string
): RoleBoundTask | undefined {
  const staticTask = bundle.taskCatalog.find((task) => task.id === taskId)
  if (staticTask) return staticTask
  const reviewTask = projection.reviewTasks[taskId]
  if (reviewTask) return reviewTask
  const dynamicTask = projection.dynamicTasks[taskId]
  if (dynamicTask) return dynamicTask
  return undefined
}

function roleVersion(bundle: WorkflowRunBundle, roleProfileId: string): number {
  const entry = bundle.run.roleCatalog.find(
    (candidate) => candidate.roleProfileId === roleProfileId
  )
  if (!entry) throw new Error(`role_not_in_run_catalog:${roleProfileId}`)
  return entry.roleProfileVersion
}
