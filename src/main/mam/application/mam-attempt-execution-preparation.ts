import type { LocalSecretBinding } from '../../../shared/mam/domain/execution-profile'
import type { WorkflowRunBundle } from '../../../shared/mam/domain/run-bundle'
import type { WorkflowRunProjection } from '../state-store/git-state-projection'
import type { AttemptSecretValueProvider } from './local-attempt-secrets'
import type { ExecutableAttemptTask } from './mam-attempt-execution-types'
import type { ConflictResolutionWorktreeManager } from './conflict-resolution-worktree-manager'
import type { AttemptWorktree } from './attempt-worktree-manager'
import { automaticReviewArtifactContract } from './automatic-review-contract'

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
    const latestAttemptId = projection.tasks[taskId]?.knownAttemptIds.at(-1)
    const reviewedAttemptId = latestAttemptId
      ? projection.attempts[latestAttemptId]?.previousAttemptId
      : undefined
    const revisionFeedback = Object.values(projection.humanReviewDecisions)
      .filter(
        (decision) =>
          decision.revisionTargetTaskId === taskId &&
          decision.status === 'changes_requested' &&
          decision.subject.attemptId === reviewedAttemptId
      )
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0]?.feedback
    return {
      ...staticTask,
      workspaceMode,
      baseRef:
        taskStatus === 'changes_requested' && projection.tasks[taskId]?.submittedCommit
          ? projection.tasks[taskId]!.submittedCommit!
          : 'HEAD',
      ...(revisionFeedback ? { revisionFeedback } : {})
    }
  }
  const dynamicTask = projection.dynamicTasks[taskId]
  if (dynamicTask) return { ...dynamicTask, workspaceMode: 'write', baseRef: 'HEAD' }
  const reviewTask = projection.reviewTasks[taskId]
  if (reviewTask) {
    // Review result shape is an internal MAM contract, including for Runs frozen
    // before the current automatic Review schema was introduced.
    const outputContracts = reviewTask.outputContracts.map(automaticReviewArtifactContract)
    return {
      ...reviewTask,
      outputContracts,
      nodeId: reviewTask.reviewNodeId,
      workspaceMode: 'read',
      baseRef: reviewTask.subject.submittedCommit ?? 'HEAD',
      reviewTask
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
    'Leave intended file changes in the workspace; MAM creates the Attempt commit and publishes it to a configured remote when distributed mode is enabled.',
    'Complete each output contract in the workspace. For code changes, MAM captures the Git diff. For file outputs, create a relative file whose name includes the artifact type.',
    'For Markdown outputs, each required section heading must include its configured section identifier.',
    ...(task.reviewTask ? reviewOutputInstructions(task) : []),
    ...(task.revisionFeedback
      ? [
          'Human review requested changes. Before modifying files, clarify any uncertainty with mam_ask_user, then call mam_confirm_understanding with your complete interpretation and wait for explicit confirmation.',
          `Human review feedback: ${task.revisionFeedback}`
        ]
      : []),
    `Output contracts: ${JSON.stringify(task.outputContracts)}`
  ].join('\n')
}

function reviewOutputInstructions(task: ExecutableAttemptTask): readonly string[] {
  const structured = task.outputContracts.some((contract) => contract.format === 'json-schema')
  if (structured) {
    return [
      'This is a Review Task. Return exactly one JSON object with status (approved, changes_requested, or blocked), summary, and findings; do not wrap it in Markdown.',
      'Use an empty findings array when approved. For changes_requested, include at least one actionable finding with severity, category, and summary; filePath and line are optional.'
    ]
  }
  return [
    'This is a Review Task. Follow the configured report contract and state exactly one explicit verdict: approved, changes_requested, or blocked.',
    'For changes_requested, list every actionable problem as a bullet. MAM converts the report into its internal Review decision.'
  ]
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
