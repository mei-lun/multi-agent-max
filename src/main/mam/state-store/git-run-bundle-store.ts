import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import {
  WorkflowRunBundleSchema,
  type WorkflowRunBundle
} from '../../../shared/mam/domain/run-bundle'
import { MamEntityIdSchema } from '../../../shared/mam/domain/primitives'
import { createWorkflowRunBundle } from '../application/workflow-run-factory'
import type { KernelEventBatch } from '../scheduler/kernel'
import { profileContentHash } from '../profiles/profile-content-hash'

export class GitRunBundleStoreError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message)
    this.name = 'GitRunBundleStoreError'
  }
}

export class GitRunBundleStore {
  private readonly stateRoot: string

  constructor(stateRoot: string) {
    this.stateRoot = resolve(stateRoot)
  }

  load(workflowRunId: string): WorkflowRunBundle | undefined {
    const path = this.bundlePath(workflowRunId)
    if (!existsSync(path)) return undefined
    const bundle = WorkflowRunBundleSchema.parse(JSON.parse(readFileSync(path, 'utf8')))
    assertBundleIntegrity(bundle)
    return bundle
  }

  validateAndWrite(input: {
    workflowRunId: string
    batch: KernelEventBatch
    bundle?: WorkflowRunBundle
  }): void {
    const createEvents = input.batch.events.filter((event) => event.type === 'workflow_run_created')
    if (createEvents.length === 0) return this.validateWithoutCreateEvent(input)
    if (createEvents.length !== 1 || !input.bundle) {
      fail('run_bundle_required', 'workflow_run_created must commit one authoritative Run Bundle')
    }
    const event = createEvents[0]!
    const bundle = WorkflowRunBundleSchema.parse(input.bundle)
    assertBundleIntegrity(bundle)
    if (
      bundle.run.id !== event.workflowRunId ||
      bundle.run.definitionId !== event.definitionId ||
      bundle.run.definitionVersion !== event.definitionVersion ||
      bundle.run.planHash !== event.planHash ||
      bundle.roleCatalogHash !== event.roleCatalogHash
    ) {
      fail('run_bundle_binding_mismatch', 'Run Bundle does not match workflow_run_created')
    }
    this.writeImmutable(bundle)
  }

  private validateWithoutCreateEvent(input: {
    workflowRunId: string
    batch: KernelEventBatch
    bundle?: WorkflowRunBundle
  }): void {
    if (!input.bundle) return
    if (input.batch.events.length > 0) {
      fail('unexpected_run_bundle', 'Run Bundle requires a workflow_run_created event')
    }
    const existing = this.load(input.workflowRunId)
    if (existing?.bundleHash !== input.bundle.bundleHash) {
      fail('run_bundle_missing', 'Idempotent Run command has no matching Git Run Bundle')
    }
  }

  private writeImmutable(bundle: WorkflowRunBundle): void {
    const path = this.bundlePath(bundle.run.id)
    if (existsSync(path)) {
      const existing = this.load(bundle.run.id)!
      if (existing.bundleHash !== bundle.bundleHash) {
        fail('run_bundle_immutable', 'Workflow Run already has a different Run Bundle')
      }
      return
    }
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
    writeFileSync(path, `${JSON.stringify(bundle, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
      flag: 'wx'
    })
  }

  private bundlePath(workflowRunId: string): string {
    const runId = MamEntityIdSchema.parse(workflowRunId)
    return join(this.stateRoot, 'runs', runId, 'run-bundle.json')
  }
}

function assertBundleIntegrity(bundle: WorkflowRunBundle): void {
  const { bundleHash, ...content } = bundle
  if (profileContentHash(content) !== bundleHash) {
    fail('run_bundle_hash_mismatch', 'Run Bundle content hash is invalid')
  }
  if (profileContentHash(bundle.run.roleCatalog) !== bundle.roleCatalogHash) {
    fail('role_catalog_hash_mismatch', 'Run Role catalog hash is invalid')
  }
  for (const role of bundle.roleProfiles ?? []) {
    const catalogEntry = bundle.run.roleCatalog.find(
      (entry) => entry.roleProfileId === role.id && entry.roleProfileVersion === role.version
    )
    if (!catalogEntry || catalogEntry.contentHash !== profileContentHash(role)) {
      fail('role_profile_hash_mismatch', 'Frozen Role Profile does not match the Run catalog')
    }
  }
  const expected = createWorkflowRunBundle({
    runId: bundle.run.id,
    definition: bundle.definition,
    roleCatalog: bundle.run.roleCatalog,
    ...(bundle.roleProfiles ? { roleProfiles: bundle.roleProfiles } : {}),
    inputArtifacts: bundle.plan.inputArtifacts,
    createdAt: bundle.createdAt
  })
  if (expected.bundleHash !== bundle.bundleHash) {
    fail('run_bundle_not_canonical', 'Run Bundle does not match the compiled Workflow')
  }
}

function fail(code: string, message: string): never {
  throw new GitRunBundleStoreError(code, message)
}
