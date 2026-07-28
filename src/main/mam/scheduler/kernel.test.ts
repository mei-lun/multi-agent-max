import { describe, expect, it } from 'vitest'
import { buildAttemptResult } from '../artifacts/attempt-result-builder'
import { SchedulerKernel } from './kernel'
import type { SchedulerKernelContext } from './scheduler-command-authority'

const hash = 'd'.repeat(64)

describe('SchedulerKernel', () => {
  it('requires user authority for Role Assignment', () => {
    const kernel = new SchedulerKernel()
    expect(() =>
      kernel.execute(assignCommand('scheduler'), taskContext('waiting_role_assignment'))
    ).toThrow(expect.objectContaining({ code: 'user_authority_required' }))
  })

  it('records concurrent execution as a warning instead of rejecting it', () => {
    const kernel = new SchedulerKernel()
    const batch = kernel.execute(announceCommand(), taskContext('running', ['attempt.1']))
    expect(batch.events[0]).toMatchObject({
      type: 'execution_announced',
      attemptId: 'attempt.2',
      concurrentAttemptIds: ['attempt.1']
    })
  })

  it('validates MAM-owned Attempt Result bindings and Artifact hashes', () => {
    const kernel = new SchedulerKernel()
    const context = taskContext('running', ['attempt.1'], true)
    const command = resultCommand()
    expect(kernel.execute(command, context).events[0]).toMatchObject({
      type: 'attempt_result_submitted',
      attemptId: 'attempt.1'
    })
    expect(() =>
      kernel.execute(
        {
          ...command,
          commandId: 'command.result.bad',
          result: { ...command.result, system: { ...command.result.system, taskId: 'task.other' } }
        },
        context
      )
    ).toThrow(expect.objectContaining({ code: 'result_binding_mismatch' }))
  })

  it('returns an empty authorized batch for an already processed command', () => {
    const kernel = new SchedulerKernel()
    const context = taskContext('waiting_role_assignment')
    const command = assignCommand('user')
    const processed = { ...context, processedCommandIds: new Set([command.commandId]) }
    expect(kernel.execute(command, processed).events).toEqual([])
  })

  it('checks command idempotency before current-state transition rules', () => {
    const kernel = new SchedulerKernel()
    const command = assignCommand('user')
    const context = taskContext('ready')
    expect(
      kernel.execute(command, {
        ...context,
        processedCommandIds: new Set([command.commandId])
      }).events
    ).toEqual([])
  })

  it('requires an execution notice and prevents rebinding a started Attempt', () => {
    const kernel = new SchedulerKernel()
    expect(() => kernel.execute(startCommand(), taskContext('ready'))).toThrow(
      expect.objectContaining({ code: 'execution_notice_required' })
    )
    expect(() =>
      kernel.execute(startCommand(), taskContext('running', ['attempt.1'], true))
    ).toThrow(expect.objectContaining({ code: 'duplicate_attempt_start' }))
  })
})

function taskContext(
  status: NonNullable<SchedulerKernelContext['task']>['status'],
  activeAttemptIds: string[] = [],
  includeBinding = false
): SchedulerKernelContext {
  return {
    schedulerId: 'scheduler.1',
    task: {
      workflowRunId: 'run.1',
      taskId: 'task.1',
      status,
      ...(status === 'waiting_role_assignment' ? {} : { assignedRoleProfileId: 'role.developer' }),
      activeAttemptIds: new Set(activeAttemptIds),
      knownAttemptIds: new Set(activeAttemptIds),
      submittedAttemptIds: new Set(),
      reviewDecisions: new Map(),
      allowedRoleProfileIds: new Set(['role.developer']),
      roleCatalogVersions: new Map([['role.developer', new Set([1])]]),
      attemptBindings: new Map(
        includeBinding
          ? [
              [
                'attempt.1',
                {
                  roleInstanceId: 'role-instance.1',
                  executorInvocationId: 'executor-invocation.1',
                  effectiveConfigHash: hash
                }
              ]
            ]
          : []
      )
    },
    validArtifactHashes: new Set([hash]),
    processedCommandIds: new Set(),
    mergeQueueEntries: new Map()
  }
}

function assignCommand(actor: 'user' | 'scheduler') {
  return {
    schemaVersion: '1.0.0',
    commandId: `command.assign.${actor}`,
    issuedAt: '2026-07-27T10:00:00Z',
    workflowRunId: 'run.1',
    taskId: 'task.1',
    actor:
      actor === 'user'
        ? { kind: 'user', userId: 'user.owner' }
        : { kind: 'scheduler', schedulerId: 'scheduler.1' },
    type: 'assign_task',
    roleProfileId: 'role.developer',
    roleProfileVersion: 1
  }
}

function announceCommand() {
  return {
    schemaVersion: '1.0.0',
    commandId: 'command.announce.2',
    issuedAt: '2026-07-27T10:00:00Z',
    workflowRunId: 'run.1',
    taskId: 'task.1',
    actor: { kind: 'scheduler', schedulerId: 'scheduler.1' },
    type: 'announce_execution',
    claimId: 'claim.2',
    attemptId: 'attempt.2',
    executorInstanceId: 'executor.2'
  }
}

function resultCommand() {
  const result = buildAttemptResult(
    {
      schemaVersion: '1.0.0',
      status: 'submitted',
      summary: 'Done.',
      verifications: [],
      risks: [],
      followUps: [],
      artifacts: [
        { contractId: 'source.diff', type: 'git_change', contentRef: 'git:abcdef1', sha256: hash }
      ],
      usage: { status: 'unknown' }
    },
    {
      workflowRunId: 'run.1',
      nodeRunId: 'node-run.1',
      taskId: 'task.1',
      attemptId: 'attempt.1',
      roleInstanceId: 'role-instance.1',
      executorInvocationId: 'executor-invocation.1',
      effectiveConfigHash: hash,
      submittedCommit: 'abcdef1',
      createdAt: '2026-07-27T10:05:00Z'
    }
  )
  return {
    schemaVersion: '1.0.0',
    commandId: 'command.result.1',
    issuedAt: '2026-07-27T10:05:00Z',
    workflowRunId: 'run.1',
    taskId: 'task.1',
    actor: {
      kind: 'executor',
      roleInstanceId: 'role-instance.1',
      attemptId: 'attempt.1',
      executorInvocationId: 'executor-invocation.1'
    },
    type: 'submit_attempt_result',
    attemptId: 'attempt.1',
    result
  }
}

function startCommand() {
  return {
    schemaVersion: '1.0.0',
    commandId: 'command.start.1',
    issuedAt: '2026-07-27T10:02:00Z',
    workflowRunId: 'run.1',
    taskId: 'task.1',
    actor: { kind: 'scheduler', schedulerId: 'scheduler.1' },
    type: 'start_attempt',
    attemptId: 'attempt.1',
    roleInstanceId: 'role-instance.1',
    executorInvocationId: 'executor-invocation.1',
    effectiveConfigSnapshotId: 'effective.1',
    effectiveConfigHash: hash
  }
}
