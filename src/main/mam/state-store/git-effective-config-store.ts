import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import {
  EffectiveRoleConfigSnapshotSchema,
  type EffectiveRoleConfigSnapshot
} from '../../../shared/mam/domain/role'
import { MamEntityIdSchema } from '../../../shared/mam/domain/primitives'
import { profileContentHash } from '../profiles/profile-content-hash'
import type { KernelEventBatch } from '../scheduler/kernel'

export class GitEffectiveConfigStoreError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message)
    this.name = 'GitEffectiveConfigStoreError'
  }
}

export class GitEffectiveConfigStore {
  private readonly stateRoot: string

  constructor(stateRoot: string) {
    this.stateRoot = resolve(stateRoot)
  }

  load(workflowRunId: string, attemptId: string): EffectiveRoleConfigSnapshot | undefined {
    const path = this.snapshotPath(workflowRunId, attemptId)
    if (!existsSync(path)) return undefined
    const snapshot = EffectiveRoleConfigSnapshotSchema.parse(JSON.parse(readFileSync(path, 'utf8')))
    assertSnapshotHash(snapshot)
    return snapshot
  }

  validateAndWrite(input: {
    workflowRunId: string
    batch: KernelEventBatch
    snapshot?: EffectiveRoleConfigSnapshot
  }): void {
    const startEvents = input.batch.events.filter((event) => event.type === 'attempt_started')
    if (startEvents.length === 0) return this.validateWithoutStartEvent(input)
    if (startEvents.length !== 1 || !input.snapshot) {
      fail(
        'effective_config_snapshot_required',
        'attempt_started must commit one Effective Config snapshot'
      )
    }
    const event = startEvents[0]!
    const snapshot = EffectiveRoleConfigSnapshotSchema.parse(input.snapshot)
    assertSnapshotHash(snapshot)
    if (
      snapshot.workflowRunId !== event.workflowRunId ||
      snapshot.taskId !== event.taskId ||
      snapshot.attemptId !== event.attemptId ||
      snapshot.id !== event.effectiveConfigSnapshotId ||
      snapshot.contentHash !== event.effectiveConfigHash
    ) {
      fail(
        'effective_config_binding_mismatch',
        'Effective Config snapshot does not match attempt_started authority fields'
      )
    }
    this.writeImmutable(input.workflowRunId, snapshot)
  }

  private validateWithoutStartEvent(input: {
    workflowRunId: string
    batch: KernelEventBatch
    snapshot?: EffectiveRoleConfigSnapshot
  }): void {
    if (!input.snapshot) return
    if (input.batch.events.length > 0) {
      fail(
        'unexpected_effective_config_snapshot',
        'Effective Config snapshot requires an attempt_started event'
      )
    }
    const existing = this.load(input.workflowRunId, input.snapshot.attemptId)
    if (existing?.contentHash !== input.snapshot.contentHash) {
      fail(
        'effective_config_snapshot_missing',
        'Idempotent Attempt command has no matching Git snapshot'
      )
    }
  }

  private writeImmutable(workflowRunId: string, snapshot: EffectiveRoleConfigSnapshot): void {
    const path = this.snapshotPath(workflowRunId, snapshot.attemptId)
    if (existsSync(path)) {
      const existing = this.load(workflowRunId, snapshot.attemptId)!
      if (existing.contentHash !== snapshot.contentHash) {
        fail(
          'effective_config_snapshot_immutable',
          'Attempt Effective Config snapshot already exists with another hash'
        )
      }
      return
    }
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
    writeFileSync(path, `${JSON.stringify(snapshot, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
      flag: 'wx'
    })
  }

  private snapshotPath(workflowRunId: string, attemptId: string): string {
    const runId = MamEntityIdSchema.parse(workflowRunId)
    const parsedAttemptId = MamEntityIdSchema.parse(attemptId)
    const name = createHash('sha256').update(parsedAttemptId).digest('hex')
    return join(this.stateRoot, 'runs', runId, 'attempt-configs', `${name}.json`)
  }
}

function assertSnapshotHash(snapshot: EffectiveRoleConfigSnapshot): void {
  const { contentHash, ...content } = snapshot
  if (profileContentHash(content) !== contentHash) {
    fail('effective_config_hash_mismatch', 'Effective Config snapshot content hash is invalid')
  }
}

function fail(code: string, message: string): never {
  throw new GitEffectiveConfigStoreError(code, message)
}
