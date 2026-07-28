import type { LocalSecretBinding } from '../../../shared/mam/domain/execution-profile'
import type { WorkflowRunBundle } from '../../../shared/mam/domain/run-bundle'
import type { WorkflowRunProjection } from '../state-store/git-state-projection'
import type { AttemptSecretValueProvider } from './local-attempt-secrets'
import type { ExecutableAttemptTask } from './mam-attempt-execution-types'
import type { ConflictResolutionWorktreeManager } from './conflict-resolution-worktree-manager'
import type { AttemptWorktree } from './attempt-worktree-manager'

export function resolveExecutableTask(
  bundle: WorkflowRunBundle,
  projection: WorkflowRunProjection,
  taskId: string,
  taskStatus: string
): ExecutableAttemptTask {
  const staticTask = bundle.taskCatalog.find((candidate) => candidate.id === taskId)
  if (staticTask) {
    const node = bundle.definition.nodes.find((candidate) => candidate.id === staticTask.nodeId)!
    const workspaceMode = node.type === 'role_task' ? node.workspaceMode : 'write'
    return {
      ...staticTask,
      workspaceMode,
      baseRef:
        taskStatus === 'changes_requested' && projection.tasks[taskId]?.submittedCommit
          ? projection.tasks[taskId]!.submittedCommit!
          : 'HEAD'
    }
  }
  const dynamicTask = projection.dynamicTasks[taskId]
  if (dynamicTask) return { ...dynamicTask, workspaceMode: 'write', baseRef: 'HEAD' }
  const reviewTask = projection.reviewTasks[taskId]
  if (reviewTask) {
    return {
      ...reviewTask,
      nodeId: reviewTask.reviewNodeId,
      workspaceMode: 'read',
      baseRef: reviewTask.subject.submittedCommit ?? 'HEAD'
    }
  }
  const conflictTask = projection.mergeConflictTasks[taskId]
  if (conflictTask) {
    return {
      nodeRunId: `node-run.${conflictTask.id}`,
      nodeId: conflictTask.mergeNodeId,
      specification: [
        `Resolve the pinned merge conflict for ${conflictTask.queueEntryId}.`,
        `Conflicting paths: ${conflictTask.conflictingPaths.join(', ')}.`
      ].join('\n'),
      inputArtifacts: [],
      outputContracts: [],
      workspaceMode: 'write',
      baseRef: conflictTask.targetCommit,
      mergeConflictTask: conflictTask
    }
  }
  throw new Error('executable_task_definition_not_found')
}

export function requireLocalBinding<T>(bindings: readonly T[], kind: string): T {
  if (bindings.length !== 1) {
    throw new Error(`${kind}_${bindings.length === 0 ? 'missing' : 'ambiguous'}`)
  }
  return bindings[0]!
}

export function resolveAttemptCredentials(
  secretRef: string | undefined,
  bindings: readonly LocalSecretBinding[],
  bindingIdentity: string,
  provider: AttemptSecretValueProvider
): Readonly<Record<string, string>> {
  if (!secretRef) return {}
  const binding = requireLocalBinding(
    bindings.filter(
      (candidate) =>
        candidate.secretRef === secretRef && candidate.bindingIdentity === bindingIdentity
    ),
    'local_secret_binding'
  )
  const value = provider.resolve(binding)
  if (!value) throw new Error(`secret_value_unavailable:${binding.id}`)
  return { [secretRef]: value }
}

export function attemptExecutionPrompt(task: ExecutableAttemptTask, branch: string): string {
  return [
    task.specification,
    '',
    `Workspace branch: ${branch}`,
    'Leave intended file changes in the workspace; MAM creates and pushes the Attempt commit.',
    'For every required output contract, write one payload file inside the workspace and declare it in artifacts.',
    `Output contracts: ${JSON.stringify(task.outputContracts)}`
  ].join('\n')
}

export function conflictAttemptWorktree(
  prepared: ReturnType<ConflictResolutionWorktreeManager['prepare']>,
  task: NonNullable<ExecutableAttemptTask['mergeConflictTask']>
): AttemptWorktree {
  return {
    path: prepared.worktreePath,
    branch: task.sourceBranch,
    baseCommit: task.targetCommit
  }
}
