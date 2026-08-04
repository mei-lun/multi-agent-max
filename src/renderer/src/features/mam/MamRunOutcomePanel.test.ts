import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { MamUiRunSnapshot } from '../../../../shared/mam/ui-projection'
import { mamUiRunFixture } from './mam-renderer-snapshot-fixture'
import { finalProductAttempt, MamRunOutcomePanel } from './MamRunOutcomePanel'

describe('Run outcome', () => {
  it('prefers the product result over a later Review result', () => {
    const run = mamUiRunFixture()
    run.tasks.push(task('task.implement', 'static', ['attempt.implement']))
    run.tasks.push(task('task.review', 'review', ['attempt.review']))
    run.attempts.push(attempt('attempt.implement', 'task.implement', 'Website files are ready.'))
    run.attempts.push(attempt('attempt.review', 'task.review', 'Review passed.'))

    expect(finalProductAttempt(run)?.result?.summary).toBe('Website files are ready.')
  })

  it('shows the completed result without opening individual Attempt history', () => {
    const run = mamUiRunFixture()
    run.run.status = 'completed'
    run.tasks.push(task('task.implement', 'static', ['attempt.implement']))
    run.attempts.push(attempt('attempt.implement', 'task.implement', 'Website files are ready.'))

    const markup = renderToStaticMarkup(MamRunOutcomePanel({ run }))
    expect(markup).toContain('Final result is ready')
    expect(markup).toContain('Website files are ready.')
  })

  it('does not call task-branch code a delivered final result', () => {
    const run = mamUiRunFixture()
    run.run.status = 'completed'
    run.tasks.push(task('task.implement', 'static', ['attempt.implement']))
    run.attempts.push(
      attempt('attempt.implement', 'task.implement', 'Website files are ready.', 'abcdef1')
    )

    const markup = renderToStaticMarkup(MamRunOutcomePanel({ run }))
    expect(markup).toContain('Result is reviewed but not delivered')
    expect(markup).toContain('still on its task branch')
    expect(markup).not.toContain('Final result is ready')
  })

  it('shows develop as runnable while waiting for final promotion', () => {
    const run = mamUiRunFixture()
    run.run.status = 'waiting_for_approval'
    run.tasks.push(task('task.implement', 'static', ['attempt.implement']))
    run.attempts.push(
      attempt('attempt.implement', 'task.implement', 'Website files are ready.', 'abcdef1')
    )
    run.mergeQueueEntries.push(mergedEntry('develop', 'abcdef2'))

    const markup = renderToStaticMarkup(MamRunOutcomePanel({ run }))
    expect(markup).toContain('Integrated result is ready on develop')
    expect(markup).toContain('Use develop for the runnable demonstration')
  })

  it('shows only a main promotion as the final delivered version', () => {
    const run = mamUiRunFixture()
    run.run.status = 'completed'
    run.tasks.push(task('task.implement', 'static', ['attempt.implement']))
    run.attempts.push(
      attempt('attempt.implement', 'task.implement', 'Website files are ready.', 'abcdef1')
    )
    run.mergeQueueEntries.push(mergedEntry('develop', 'abcdef2'))
    run.mergeQueueEntries.push(mergedEntry('main', 'abcdef3'))

    const markup = renderToStaticMarkup(MamRunOutcomePanel({ run }))
    expect(markup).toContain('Final version is ready on main')
    expect(markup).toContain('The accepted integrated revision is now on main')
  })
})

function task(id: string, kind: 'static' | 'review', attemptIds: string[]) {
  return {
    id,
    title: id,
    kind,
    status: 'submitted' as const,
    dependencies: [],
    recommendedRoleProfileIds: [],
    allowedRoleProfileIds: [],
    attemptIds,
    reviewIds: [],
    executionWarningCount: 0
  }
}

function attempt(id: string, taskId: string, summary: string, submittedCommit?: string) {
  return {
    id,
    taskId,
    status: 'submitted' as const,
    result: {
      schemaVersion: '1.0.0' as const,
      status: 'submitted' as const,
      summary,
      verifications: [],
      risks: [],
      followUps: [],
      artifacts: [],
      usage: { status: 'unknown' as const },
      system: {
        workflowRunId: 'run.ui',
        nodeRunId: 'node.one',
        taskId,
        attemptId: id,
        roleInstanceId: 'role-instance.one',
        executorInvocationId: 'invocation.one',
        effectiveConfigHash: 'a'.repeat(64),
        ...(submittedCommit ? { submittedCommit } : {}),
        createdAt: '2026-07-28T18:00:00Z'
      }
    }
  }
}

function mergedEntry(
  targetBranch: string,
  mergeCommit: string
): MamUiRunSnapshot['mergeQueueEntries'][number] {
  return {
    schemaVersion: '1.0.0',
    id: `merge-entry.${targetBranch}`,
    workflowRunId: 'run.ui',
    mergeNodeId: `merge-${targetBranch}`,
    taskId: 'task.implement',
    attemptId: 'attempt.implement',
    targetBranch,
    sourceBranch: targetBranch === 'main' ? 'develop' : 'mam/task/implement',
    submittedCommit: 'abcdef1',
    resultHash: 'b'.repeat(64),
    mergeReadyAt: '2026-07-28T18:00:00Z',
    readyRevisionHash: 'c'.repeat(64),
    reviewDecisionIds: ['review.one'],
    validationEvidence: {},
    strategy: 'no_ff',
    conflictPolicy: 'coordinator_attempt',
    status: 'merged',
    completedAt: '2026-07-28T18:01:00Z',
    mergeCommit
  }
}
