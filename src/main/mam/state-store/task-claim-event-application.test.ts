import { describe, expect, it } from 'vitest'
import type { SchedulerEvent } from '../../../shared/mam/scheduler-protocol'
import type { TaskProjection } from './git-state-projection'
import { applyTaskClaimEvent } from './task-claim-event-application'

describe('Task Claim event application', () => {
  it('claims, takes over, and releases a Task deterministically', () => {
    const tasks = { 'task.1': task() }
    applyTaskClaimEvent({ event: claimedEvent(), tasks })
    expect(tasks['task.1'].activeClaim).toMatchObject({ claimId: 'claim.1', generation: 1 })

    applyTaskClaimEvent({ event: takeoverEvent(), tasks })
    expect(tasks['task.1'].activeClaim).toMatchObject({ claimId: 'claim.2', generation: 2 })

    applyTaskClaimEvent({ event: releasedEvent(), tasks })
    expect(tasks['task.1'].activeClaim).toBeUndefined()
    expect(tasks['task.1'].lastClaimGeneration).toBe(2)
  })
})

function task(): TaskProjection {
  return {
    status: 'ready',
    roleProfileId: 'role.worker',
    roleProfileVersion: 1,
    activeAttemptIds: [],
    knownAttemptIds: [],
    reviewIds: [],
    executionWarnings: [],
    lastEventId: 'event.assignment'
  }
}

function claimedEvent(): Extract<SchedulerEvent, { type: 'task_claimed' }> {
  return {
    ...eventEnvelope('command.claim'),
    type: 'task_claimed',
    taskId: 'task.1',
    claim: claim('claim.1', 1)
  }
}

function takeoverEvent(): Extract<SchedulerEvent, { type: 'task_claim_taken_over' }> {
  return {
    ...eventEnvelope('command.takeover'),
    type: 'task_claim_taken_over',
    taskId: 'task.1',
    previousClaimId: 'claim.1',
    previousGeneration: 1,
    claim: claim('claim.2', 2),
    reason: 'The previous machine is unavailable.',
    takenOverByUserId: 'user.local'
  }
}

function releasedEvent(): Extract<SchedulerEvent, { type: 'task_claim_released' }> {
  return {
    ...eventEnvelope('command.release'),
    type: 'task_claim_released',
    taskId: 'task.1',
    claimId: 'claim.2',
    generation: 2,
    releasedByUserId: 'user.local'
  }
}

function claim(claimId: string, generation: number) {
  return {
    schemaVersion: '1.0.0' as const,
    claimId,
    taskId: 'task.1',
    roleProfileId: 'role.worker',
    roleProfileVersion: 1,
    claimantInstanceId: `claimant.${generation}`,
    generation,
    claimedAt: '2026-09-17T09:00:00Z'
  }
}

function eventEnvelope(commandId: string) {
  return {
    schemaVersion: '1.0.0' as const,
    eventId: `${commandId}:event:1`,
    commandId,
    createdAt: '2026-09-17T09:00:00Z',
    workflowRunId: 'run.1',
    schedulerId: 'scheduler.desktop',
    parentRevision: 'a'.repeat(64)
  }
}
