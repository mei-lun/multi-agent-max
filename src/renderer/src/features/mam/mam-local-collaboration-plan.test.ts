import { describe, expect, it } from 'vitest'
import {
  mamUiFixtureHash,
  mamUiRoleFixture,
  mamUiRunFixture,
  mamUiSnapshotFixture
} from './mam-renderer-snapshot-fixture'
import {
  nextMamLocalCollaborationAction,
  nextMamLocalMergeRunId
} from './mam-local-collaboration-plan'

describe('local collaboration plan', () => {
  it('assigns an unassigned Task to a participating recommended Role', () => {
    const run = mamUiRunFixture()
    run.run.roleCatalog = [
      { roleProfileId: 'role.design', roleProfileVersion: 2, contentHash: 'a'.repeat(64) }
    ]
    run.tasks.push({
      id: 'task.design',
      title: 'Create design',
      kind: 'static',
      status: 'waiting_role_assignment',
      dependencies: [],
      recommendedRoleProfileIds: ['role.design'],
      allowedRoleProfileIds: ['role.design'],
      attemptIds: [],
      reviewIds: [],
      executionWarningCount: 0
    })

    expect(nextMamLocalCollaborationAction(run, ['role.design'])).toEqual({
      kind: 'assign',
      input: {
        workflowRunId: 'run.ui',
        taskId: 'task.design',
        roleProfileId: 'role.design',
        roleProfileVersion: 2
      }
    })
  })

  it('starts a ready Task assigned to a participating Role', () => {
    const run = mamUiRunFixture()
    run.tasks.push({
      id: 'task.implement',
      title: 'Implement',
      kind: 'static',
      status: 'ready',
      roleProfileId: 'role.developer',
      roleProfileVersion: 1,
      dependencies: [],
      recommendedRoleProfileIds: [],
      allowedRoleProfileIds: ['role.developer'],
      attemptIds: [],
      reviewIds: [],
      executionWarningCount: 0
    })

    expect(nextMamLocalCollaborationAction(run, ['role.developer'])).toEqual({
      kind: 'start',
      input: { workflowRunId: 'run.ui', taskId: 'task.implement' }
    })
  })

  it('identifies the active Task instead of implying the workflow is stuck', () => {
    const run = mamUiRunFixture()
    run.tasks.push({
      id: 'task.design',
      title: 'Create design spec',
      kind: 'static',
      status: 'running',
      roleProfileId: 'role.design',
      roleProfileVersion: 1,
      dependencies: [],
      recommendedRoleProfileIds: ['role.design'],
      allowedRoleProfileIds: ['role.design'],
      attemptIds: ['attempt.design'],
      reviewIds: [],
      executionWarningCount: 0
    })
    run.attempts.push({
      id: 'attempt.design',
      taskId: 'task.design',
      status: 'running'
    })

    expect(nextMamLocalCollaborationAction(run, ['role.design'])).toEqual({
      kind: 'wait',
      reason: 'active',
      message:
        'Local Role is working on Create design spec. This may take several minutes. No action is needed; the next Task will start automatically.'
    })
  })

  it('adds a reviewed queued result to the project', () => {
    const run = mamUiRunFixture()
    run.mergeQueueEntries.push({
      schemaVersion: '1.0.0',
      id: 'merge.one',
      workflowRunId: run.run.id,
      mergeNodeId: 'node.merge',
      taskId: 'task.implement',
      attemptId: 'attempt.implement',
      targetBranch: 'main',
      sourceBranch: 'mam/task.implement',
      submittedCommit: 'abcdef1',
      resultHash: mamUiFixtureHash,
      mergeReadyAt: '2026-07-28T18:00:00Z',
      readyRevisionHash: mamUiFixtureHash,
      reviewDecisionIds: ['review.one'],
      validationEvidence: {},
      strategy: 'no_ff',
      conflictPolicy: 'coordinator_attempt',
      status: 'queued'
    })

    expect(nextMamLocalCollaborationAction(run, [])).toEqual({
      kind: 'merge',
      input: { workflowRunId: 'run.ui' }
    })
  })

  it('preserves deterministic merge order across authorized local Runs', () => {
    const later = runWithQueuedMerge('run.later', '2026-07-28T19:00:00Z')
    const earlier = runWithQueuedMerge('run.earlier', '2026-07-28T18:00:00Z')
    const snapshot = {
      ...mamUiSnapshotFixture(),
      runs: [later, earlier]
    }

    expect(nextMamLocalMergeRunId(snapshot, ['run.later', 'run.earlier'], [])).toBe('run.earlier')
  })

  it('pauses with a concrete question when reconciliation is required', () => {
    const run = mamUiRunFixture()
    run.tasks.push({
      id: 'task.design',
      title: 'Create design',
      kind: 'static',
      status: 'needs_attention',
      dependencies: [],
      recommendedRoleProfileIds: [],
      allowedRoleProfileIds: ['role.design'],
      attemptIds: ['attempt.failed'],
      reviewIds: [],
      executionWarningCount: 0
    })
    run.attempts.push({
      id: 'attempt.failed',
      taskId: 'task.design',
      status: 'needs_reconciliation',
      interruption: {
        stage: 'artifact_validation',
        code: 'required_artifact_missing',
        summary: 'The result was incomplete.',
        nextStep: 'Retry this Task.',
        worktreeRetained: true
      }
    })

    expect(nextMamLocalCollaborationAction(run, ['role.design'])).toEqual({
      kind: 'wait',
      reason: 'human_decision',
      message:
        'Create design could not produce an acceptable result after automatic retries. Open it and choose Retry this Task.'
    })
  })

  it('automatically replaces a safe internal result validation failure', () => {
    const run = mamUiRunFixture()
    const role = mamUiRoleFixture()
    run.roleProfiles = [role]
    run.tasks.push({
      id: 'task.review',
      title: 'Review submitted work',
      kind: 'review',
      status: 'needs_attention',
      roleProfileId: role.id,
      roleProfileVersion: role.version,
      dependencies: [],
      recommendedRoleProfileIds: [role.id],
      allowedRoleProfileIds: [role.id],
      attemptIds: ['attempt.review.old', 'attempt.review'],
      reviewIds: [],
      executionWarningCount: 0
    })
    run.attempts.push({
      id: 'attempt.review',
      taskId: 'task.review',
      status: 'needs_reconciliation',
      interruption: {
        stage: 'artifact_validation',
        code: 'artifact_contract_invalid',
        summary: 'The internal Review result did not match its contract.',
        nextStep: 'Retry this Task.',
        worktreeRetained: true
      }
    })

    expect(nextMamLocalCollaborationAction(run, [role.id])).toEqual({
      kind: 'recover',
      input: {
        workflowRunId: run.run.id,
        taskId: 'task.review',
        previousAttemptId: 'attempt.review',
        resolution: 'start_new_attempt',
        reason: 'Retry a safely isolated result or Artifact validation failure automatically.'
      }
    })
  })
})

function runWithQueuedMerge(runId: string, mergeReadyAt: string) {
  const run = mamUiRunFixture()
  run.run.id = runId
  run.mergeQueueEntries.push({
    schemaVersion: '1.0.0',
    id: `merge.${runId}`,
    workflowRunId: runId,
    mergeNodeId: 'node.merge',
    taskId: 'task.implement',
    attemptId: 'attempt.implement',
    targetBranch: 'main',
    sourceBranch: `mam/${runId}`,
    submittedCommit: 'abcdef1',
    resultHash: mamUiFixtureHash,
    mergeReadyAt,
    readyRevisionHash: mamUiFixtureHash,
    reviewDecisionIds: ['review.one'],
    validationEvidence: {},
    strategy: 'no_ff',
    conflictPolicy: 'coordinator_attempt',
    status: 'queued'
  })
  return run
}
