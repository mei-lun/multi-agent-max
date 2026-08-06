import type {
  MamAssignTaskInput,
  MamExecuteNextMergeInput,
  MamRecoverAttemptInput,
  MamStartAttemptInput
} from '../../../../shared/mam/application-command'
import type { MamUiRunSnapshot, MamUiSnapshot } from '../../../../shared/mam/ui-projection'

export type MamLocalCollaborationAction =
  | Readonly<{ kind: 'assign'; input: MamAssignTaskInput }>
  | Readonly<{ kind: 'recover'; input: MamRecoverAttemptInput }>
  | Readonly<{ kind: 'start'; input: MamStartAttemptInput }>
  | Readonly<{ kind: 'merge'; input: MamExecuteNextMergeInput }>
  | Readonly<{
      kind: 'wait'
      reason: 'active' | 'human_decision' | 'local_setup' | 'workflow' | 'complete'
      message: string
    }>

export function nextMamLocalCollaborationAction(
  run: MamUiRunSnapshot,
  participatingRoleProfileIds: readonly string[]
): MamLocalCollaborationAction {
  if (run.run.status === 'completed' || run.run.status === 'cancelled') {
    return wait('complete', 'This Run has finished local collaboration.')
  }
  const pendingGate = run.approvalGates?.find((gate) => gate.status === 'pending')
  if (pendingGate) {
    return wait('human_decision', `Your decision is needed: ${pendingGate.prompt}`)
  }
  const disagreement = run.reviewAggregations.find(
    (aggregation) =>
      aggregation.requiresHumanDecision &&
      !run.reviewDisagreementResolutions.some(
        (resolution) => resolution.aggregationId === aggregation.id
      )
  )
  if (disagreement) {
    return wait('human_decision', 'Reviewers disagree. Choose the result to continue.')
  }
  const attentionTask = run.tasks.find((task) => task.status === 'needs_attention')
  if (attentionTask) {
    const recovery = safeResultRecovery(run, attentionTask)
    if (recovery) return recovery
    return wait('human_decision', attentionTaskMessage(run, attentionTask))
  }
  const activeAttempt = run.attempts.find(
    (attempt) => attempt.status === 'announced' || attempt.status === 'running'
  )
  if (activeAttempt) {
    const task = run.tasks.find((candidate) => candidate.id === activeAttempt.taskId)
    return wait(
      'active',
      `Local Role is working on ${task?.title ?? activeAttempt.taskId}. This may take several minutes. No action is needed; the next Task will start automatically.`
    )
  }
  if (run.mergeQueueEntries.some((entry) => entry.status === 'queued')) {
    return { kind: 'merge', input: { workflowRunId: run.run.id } }
  }
  if (run.mergeQueueEntries.some((entry) => entry.status === 'failed')) {
    return wait(
      'human_decision',
      'The reviewed result could not be added to the project. Open Merge Queue for the reason, fix the project state, then use Clear and restart.'
    )
  }
  const unassigned = run.tasks.find((task) => task.status === 'waiting_role_assignment')
  if (unassigned) {
    const role = selectedRoleForTask(run, unassigned, participatingRoleProfileIds)
    if (!role) {
      return wait(
        'local_setup',
        `Activate the fixed Workflow Role for ${unassigned.title} on this machine to continue.`
      )
    }
    return {
      kind: 'assign',
      input: {
        workflowRunId: run.run.id,
        taskId: unassigned.id,
        roleProfileId: role.roleProfileId,
        roleProfileVersion: role.roleProfileVersion
      }
    }
  }
  const startable = run.tasks.find(
    (task) =>
      (task.status === 'ready' || task.status === 'changes_requested') &&
      Boolean(task.roleProfileId) &&
      participatingRoleProfileIds.includes(task.roleProfileId!)
  )
  if (startable) {
    return {
      kind: 'start',
      input: { workflowRunId: run.run.id, taskId: startable.id }
    }
  }
  const remoteAssignment = run.tasks.find(
    (task) =>
      (task.status === 'ready' || task.status === 'changes_requested') &&
      Boolean(task.roleProfileId) &&
      !participatingRoleProfileIds.includes(task.roleProfileId!)
  )
  if (remoteAssignment) {
    return wait(
      'local_setup',
      `${remoteAssignment.title} is fixed to a Role that is not active on this machine.`
    )
  }
  if (run.tasks.some((task) => task.status === 'approved') || hasMissingPromotionReadiness(run)) {
    return { kind: 'merge', input: { workflowRunId: run.run.id } }
  }
  return wait(
    'workflow',
    run.run.status === 'blocked'
      ? 'The Workflow cannot advance automatically. Open the affected Task for the required action.'
      : 'Waiting for the Workflow to produce the next Task.'
  )
}

function hasMissingPromotionReadiness(run: MamUiRunSnapshot): boolean {
  const completedTaskIds = new Set(
    run.tasks.filter((task) => task.status === 'completed').map((task) => task.id)
  )
  return (
    run.approvalGates?.some((gate) => gate.status === 'resolved') === true &&
    run.nodeRuns.some((node) => node.status === 'ready') &&
    run.mergeQueueEntries.some(
      (entry) => entry.status === 'merged' && completedTaskIds.has(entry.taskId)
    )
  )
}

function attentionTaskMessage(
  run: MamUiRunSnapshot,
  task: MamUiRunSnapshot['tasks'][number]
): string {
  const interruption = [...task.attemptIds]
    .reverse()
    .map((attemptId) => run.attempts.find((attempt) => attempt.id === attemptId)?.interruption)
    .find(Boolean)
  if (interruption && interruption.stage !== 'executor') {
    return `${task.title} could not produce an acceptable result after automatic retries. Open it and choose Retry this Task.`
  }
  return `Before retrying ${task.title}, confirm whether the Role changed anything outside its isolated workspace.`
}

function safeResultRecovery(
  run: MamUiRunSnapshot,
  task: MamUiRunSnapshot['tasks'][number]
): MamLocalCollaborationAction | undefined {
  const attempt = [...task.attemptIds]
    .reverse()
    .map((attemptId) => run.attempts.find((candidate) => candidate.id === attemptId))
    .find((candidate) => candidate?.interruption)
  if (!attempt?.interruption || attempt.interruption.stage === 'executor') return undefined
  const role = run.roleProfiles.find(
    (candidate) =>
      candidate.id === task.roleProfileId && candidate.version === task.roleProfileVersion
  )
  if (!role) return undefined
  // A legacy Review schema mismatch is a MAM compatibility failure, not a Role failure.
  const compatibilityAttempt =
    task.kind === 'review' && attempt.interruption.code === 'artifact_contract_invalid' ? 1 : 0
  if (task.attemptIds.length >= role.retry.maxAttempts + compatibilityAttempt) return undefined
  return {
    kind: 'recover',
    input: {
      workflowRunId: run.run.id,
      taskId: task.id,
      previousAttemptId: attempt.id,
      resolution: 'start_new_attempt',
      reason: 'Retry a safely isolated result or Artifact validation failure automatically.'
    }
  }
}

export function activeLocalCollaborationRunIds(snapshot: MamUiSnapshot): readonly string[] {
  return snapshot.localSettings.automaticWorkflowRunIds ?? []
}

export function nextMamLocalMergeRunId(
  snapshot: MamUiSnapshot,
  activeRunIds: readonly string[],
  participatingRoleProfileIds: readonly string[]
): string | undefined {
  const candidates = snapshot.runs
    .filter((run) => activeRunIds.includes(run.run.id))
    .filter(
      (run) => nextMamLocalCollaborationAction(run, participatingRoleProfileIds).kind === 'merge'
    )
  const queued = candidates
    .flatMap((run) =>
      run.mergeQueueEntries
        .filter((entry) => entry.status === 'queued')
        .map((entry) => ({ workflowRunId: run.run.id, entry }))
    )
    .sort(
      (left, right) =>
        left.entry.mergeReadyAt.localeCompare(right.entry.mergeReadyAt) ||
        left.entry.taskId.localeCompare(right.entry.taskId) ||
        left.entry.id.localeCompare(right.entry.id)
    )[0]?.workflowRunId
  return (
    queued ?? candidates.sort((left, right) => left.run.id.localeCompare(right.run.id))[0]?.run.id
  )
}

function selectedRoleForTask(
  run: MamUiRunSnapshot,
  task: MamUiRunSnapshot['tasks'][number],
  participatingRoleProfileIds: readonly string[]
) {
  const roleProfileId = task.allowedRoleProfileIds[0]
  if (!roleProfileId || !participatingRoleProfileIds.includes(roleProfileId)) return undefined
  return run.run.roleCatalog.find((entry) => entry.roleProfileId === roleProfileId)
}

function wait(
  reason: Extract<MamLocalCollaborationAction, { kind: 'wait' }>['reason'],
  message: string
): MamLocalCollaborationAction {
  return { kind: 'wait', reason, message }
}
