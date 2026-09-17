import { describe, expect, it } from 'vitest'
import type { SchedulerCommand } from '../../../shared/mam/scheduler-protocol'
import type { SchedulerTaskContext } from './scheduler-kernel-context'
import { assertTaskClaimAuthority } from './task-claim-command-authority'

describe('Task Claim authority', () => {
  it('accepts the first fixed-Role Claim and rejects a duplicate', () => {
    expect(() =>
      assertTaskClaimAuthority(claimCommand(), taskContext(), 'scheduler.desktop')
    ).not.toThrow()
    expect(() =>
      assertTaskClaimAuthority(
        claimCommand(),
        taskContext({ claimId: 'claim.current', generation: 1 }),
        'scheduler.desktop'
      )
    ).toThrow(expect.objectContaining({ code: 'task_already_claimed' }))
  })

  it('requires a matching generation for release and takeover', () => {
    const task = taskContext({ claimId: 'claim.current', generation: 2 })
    expect(() => assertTaskClaimAuthority(releaseCommand(1), task, 'scheduler.desktop')).toThrow(
      expect.objectContaining({ code: 'stale_claim' })
    )
    expect(() =>
      assertTaskClaimAuthority(takeoverCommand(2), task, 'scheduler.desktop')
    ).not.toThrow()
  })
})

function claimCommand(): Extract<SchedulerCommand, { type: 'claim_task' }> {
  return {
    ...envelope(),
    actor: { kind: 'scheduler', schedulerId: 'scheduler.desktop' },
    type: 'claim_task',
    claimId: 'claim.new',
    claimantInstanceId: 'claimant.local'
  }
}

function releaseCommand(
  generation: number
): Extract<SchedulerCommand, { type: 'release_task_claim' }> {
  return {
    ...envelope(),
    actor: { kind: 'user', userId: 'user.local' },
    type: 'release_task_claim',
    claimId: 'claim.current',
    generation
  }
}

function takeoverCommand(
  expectedGeneration: number
): Extract<SchedulerCommand, { type: 'force_takeover_task' }> {
  return {
    ...envelope(),
    actor: { kind: 'user', userId: 'user.local' },
    type: 'force_takeover_task',
    previousClaimId: 'claim.current',
    expectedGeneration,
    newClaimId: 'claim.takeover',
    claimantInstanceId: 'claimant.takeover',
    reason: 'The previous machine is unavailable.'
  }
}

function envelope() {
  return {
    schemaVersion: '1.0.0' as const,
    commandId: 'command.claim',
    issuedAt: '2026-09-17T09:00:00Z',
    workflowRunId: 'run.1',
    taskId: 'task.1'
  }
}

function taskContext(activeClaim?: { claimId: string; generation: number }): SchedulerTaskContext {
  return {
    workflowRunId: 'run.1',
    taskId: 'task.1',
    status: 'ready',
    assignedRoleProfileId: 'role.worker',
    assignedRoleProfileVersion: 1,
    activeAttemptIds: new Set(),
    knownAttemptIds: new Set(),
    submittedAttemptIds: new Set(),
    attemptBindings: new Map(),
    allowedRoleProfileIds: new Set(['role.worker']),
    roleCatalogVersions: new Map([['role.worker', new Set([1])]]),
    reviewDecisions: new Map(),
    ...(activeClaim
      ? {
          activeClaim: {
            schemaVersion: '1.0.0',
            ...activeClaim,
            taskId: 'task.1',
            roleProfileId: 'role.worker',
            roleProfileVersion: 1,
            claimantInstanceId: 'claimant.current',
            claimedAt: '2026-09-17T08:00:00Z'
          }
        }
      : {})
  }
}
