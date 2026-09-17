import { describe, expect, it, vi } from 'vitest'
import { executeTaskClaimUiCommand } from './task-claim-command-service'

describe('Task Claim UI command service', () => {
  it('publishes a scheduler Claim without accepting claimant identity from the renderer', () => {
    const executeAndPush = vi.fn()
    executeTaskClaimUiCommand({
      action: 'claim',
      request: { workflowRunId: 'run.1', taskId: 'task.1' },
      userId: 'user.local',
      schedulerId: 'scheduler.desktop',
      claimantInstanceId: 'claimant.host',
      nextId: (kind) => (kind === 'claim' ? 'claim.1' : 'command.1'),
      issuedAt: '2026-09-17T09:00:00Z',
      publisher: { executeAndPush },
      onStateChanged: vi.fn(),
      getSnapshot: () => ({ marker: true }) as never
    })

    expect(executeAndPush).toHaveBeenCalledWith({
      schedulerId: 'scheduler.desktop',
      command: expect.objectContaining({
        type: 'claim_task',
        claimId: 'claim.1',
        claimantInstanceId: 'claimant.host',
        actor: { kind: 'scheduler', schedulerId: 'scheduler.desktop' }
      })
    })
  })

  it('requires the current generation and a reason when taking over', () => {
    const executeAndPush = vi.fn()
    expect(() =>
      executeTaskClaimUiCommand({
        action: 'takeover',
        request: {
          workflowRunId: 'run.1',
          taskId: 'task.1',
          previousClaimId: 'claim.old',
          expectedGeneration: 1,
          reason: ''
        },
        userId: 'user.local',
        schedulerId: 'scheduler.desktop',
        claimantInstanceId: 'claimant.host',
        nextId: (kind) => `${kind}.1`,
        issuedAt: '2026-09-17T09:00:00Z',
        publisher: { executeAndPush },
        onStateChanged: vi.fn(),
        getSnapshot: () => ({ marker: true }) as never
      })
    ).toThrow()
    expect(executeAndPush).not.toHaveBeenCalled()
  })
})
