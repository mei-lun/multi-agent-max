import { describe, expect, it } from 'vitest'
import { emptyWorkflowRunProjection } from '../state-store/git-event-projection'
import type {
  AttemptProjection,
  TaskProjection,
  WorkflowRunProjection
} from '../state-store/git-state-projection'
import { resolveAttemptStartIdentity } from './attempt-start-identity'

describe('Attempt start identity', () => {
  it('reuses the unique recovery plan and its immutable lineage', () => {
    const projection = recoveryProjection({
      knownAttemptIds: ['attempt.interrupted', 'attempt.replacement'],
      attempts: {
        'attempt.interrupted': attempt('blocked'),
        'attempt.replacement': attempt('recovery_planned', 'attempt.interrupted')
      }
    })

    expect(startIdentity(projection, 'ready')).toEqual({
      attemptId: 'attempt.replacement',
      previousAttemptId: 'attempt.interrupted'
    })
  })

  it('uses the selected submitted Attempt for rework after an old plan was blocked', () => {
    const projection = recoveryProjection({
      knownAttemptIds: ['attempt.submitted', 'attempt.blocked-plan'],
      selectedAttemptId: 'attempt.submitted',
      attempts: {
        'attempt.submitted': attempt('submitted'),
        'attempt.blocked-plan': attempt('blocked', 'attempt.interrupted')
      }
    })

    expect(startIdentity(projection, 'changes_requested')).toEqual({
      attemptId: 'attempt.generated',
      previousAttemptId: 'attempt.submitted'
    })
  })

  it('rejects legacy state with more than one unconsumed recovery plan', () => {
    const projection = recoveryProjection({
      knownAttemptIds: ['attempt.plan-one', 'attempt.plan-two'],
      attempts: {
        'attempt.plan-one': attempt('recovery_planned', 'attempt.first'),
        'attempt.plan-two': attempt('recovery_planned', 'attempt.second')
      }
    })

    expect(() => startIdentity(projection, 'ready')).toThrow('multiple_recovery_plans')
  })
})

function startIdentity(projection: WorkflowRunProjection, taskStatus: string) {
  return resolveAttemptStartIdentity({
    projection,
    taskId: 'task.recovery',
    taskStatus,
    createAttemptId: () => 'attempt.generated'
  })
}

function recoveryProjection(input: {
  knownAttemptIds: readonly string[]
  selectedAttemptId?: string
  attempts: Readonly<Record<string, AttemptProjection>>
}): WorkflowRunProjection {
  const base = emptyWorkflowRunProjection('run.recovery')
  const task: TaskProjection = {
    status: 'ready',
    roleProfileId: 'role.builder',
    roleProfileVersion: 1,
    activeAttemptIds: [],
    knownAttemptIds: input.knownAttemptIds,
    ...(input.selectedAttemptId ? { selectedAttemptId: input.selectedAttemptId } : {}),
    reviewIds: [],
    executionWarnings: [],
    lastEventId: 'event.task'
  }
  return {
    ...base,
    tasks: { 'task.recovery': task },
    attempts: input.attempts
  }
}

function attempt(
  status: AttemptProjection['status'],
  previousAttemptId?: string
): AttemptProjection {
  return {
    taskId: 'task.recovery',
    ...(previousAttemptId ? { previousAttemptId } : {}),
    status,
    lastEventId: `event.${status}`
  }
}
