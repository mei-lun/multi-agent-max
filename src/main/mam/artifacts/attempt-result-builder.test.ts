import { describe, expect, it } from 'vitest'
import { buildAttemptResult } from './attempt-result-builder'

const hash = 'c'.repeat(64)

describe('Attempt result authority', () => {
  it('combines Agent fields with MAM-owned authority fields', () => {
    const result = buildAttemptResult(payload(), authority())
    expect(result).toMatchObject({
      status: 'submitted',
      system: { taskId: 'task.1', attemptId: 'attempt.1', effectiveConfigHash: hash }
    })
  })

  it('rejects natural-language completion and Agent-authored authority fields', () => {
    expect(() => buildAttemptResult('done', authority())).toThrow()
    expect(() => buildAttemptResult({ ...payload(), taskId: 'task.fake' }, authority())).toThrow()
  })
})

function payload() {
  return {
    schemaVersion: '1.0.0',
    status: 'submitted',
    summary: 'Implemented and verified.',
    verifications: [{ command: 'pnpm test', status: 'passed' }],
    risks: [],
    followUps: [],
    artifacts: [
      {
        contractId: 'source.diff',
        type: 'git_change',
        contentRef: 'git:abcdef1',
        sha256: hash
      }
    ],
    usage: { status: 'unknown' }
  }
}

function authority() {
  return {
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
}
