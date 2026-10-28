import { afterAll, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { LocalExecutionDraft } from '../../../shared/mam/local-execution-draft'
import { requireLocalConnectionRetryDecision } from './local-connection-retry-guard'

const worktreePath = mkdtempSync(join(tmpdir(), 'mam-retry-guard-'))
afterAll(() => rmSync(worktreePath, { recursive: true, force: true }))
const draft = {
  state: 'waiting_for_resume',
  lastErrorCode: 'executor_connection_failed',
  continuationAttempts: 1,
  executorKind: 'codex-cli',
  activeRuntimeMs: 10_000,
  worktreePath,
  frozenExecution: { resolvedConfig: { snapshot: {
    retry: { maxAttempts: 2 }, budget: { maxDurationSeconds: 600 }
  } } }
} as unknown as LocalExecutionDraft

describe('local connection retry decision', () => {
  it('requires the user after automatic retries are exhausted', () => {
    expect(() => requireLocalConnectionRetryDecision(draft, false))
      .toThrow('local_connection_retry_requires_user')
    expect(() => requireLocalConnectionRetryDecision(draft, true)).not.toThrow()
  })

  it('refuses a continuation without enough remaining runtime', () => {
    expect(() => requireLocalConnectionRetryDecision({
      ...draft, activeRuntimeMs: 550_000
    }, true)).toThrow('attempt_budget_insufficient')
  })

  it('refuses a missing retained worktree even after user confirmation', () => {
    expect(() => requireLocalConnectionRetryDecision({ ...draft,
      worktreePath: join(worktreePath, 'missing') }, true))
      .toThrow('attempt_worktree_unavailable')
  })
})
