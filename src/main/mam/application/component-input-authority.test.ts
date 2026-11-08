import { test, expect, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { LocalArtifactStore } from '../artifacts/local-artifact-store'
import { AttemptArtifactValidator } from './attempt-artifact-validator'
import { ArtifactContractSchema } from '../../../shared/mam/domain/artifact'
import { createHash } from 'node:crypto'
import { monitorComponentClaim } from './component-claim-monitor'
import type { PreparedAttempt } from './mam-attempt-execution-types'
import type { GitStateRepository } from '../state-store/git-state-repository'
test('trusted delivered claim resolves semantic workflow input to verified formal ref and grants consumer', async () => {
  const root = await mkdtemp(join(tmpdir(), 'component-input-'))
  try {
    const store = new LocalArtifactStore(root),
      validator = new AttemptArtifactValidator(store)
    const artifactId = `artifact.${createHash('sha256').update(['attempt.source', 'binary.output', '0'].join('\0')).digest('hex').slice(0, 40)}`
    const version = await store.writeAssetBundle({
      artifactId,
      artifactType: 'binary.output',
      workflowRunId: 'run.1',
      nodeRunId: 'node.source',
      taskId: 'task.source',
      attemptId: 'attempt.source',
      roleInstanceId: 'role.source',
      inputs: [],
      source: { componentId: 'creative.image', componentVersion: '1' },
      contract: ArtifactContractSchema.parse({
        schemaVersion: '1.0.0',
        artifactType: 'binary.output',
        format: 'asset-bundle',
        maxBytes: 10000
      }),
      files: [
        {
          logicalPath: 'a.png',
          mime: 'image/png',
          stream: (async function* () {
            yield Buffer.from('png')
          })()
        }
      ]
    })
    const bundle = { run: { id: 'run.1' }, plan: { inputArtifacts: [] } } as unknown as Parameters<
      typeof validator.authorizeComponentInputs
    >[0]
    const projection = {
      attempts: {
        'attempt.source': {
          status: 'submitted',
          result: {
            artifacts: [
              { type: 'binary.output', contractId: 'binary.output', sha256: version.contentHash }
            ]
          }
        }
      }
    } as unknown as Parameters<typeof validator.authorizeComponentInputs>[1]
    const task = {
      nodeId: 'consumer',
      inputArtifacts: [{ artifactId: 'binary.output', version: 1, contentHash: 'a'.repeat(64) }],
      inputArtifactContext: [
        {
          artifactType: 'binary.output',
          source: 'workflow',
          producerAttemptId: 'attempt.source',
          expectedHash: version.contentHash
        }
      ]
    } as unknown as Parameters<typeof validator.authorizeComponentInputs>[2]
    const refs = await validator.authorizeComponentInputs(bundle, projection, task)
    expect((await store.readForNode('run.1', 'consumer', refs[0]!)).version.id).toBe(artifactId)
    await expect(
      validator.authorizeComponentInputs(bundle, { attempts: {} } as never, task)
    ).rejects.toThrow()
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
test('claim generation revocation aborts the active port signal', () => {
  vi.useFakeTimers()
  let generation = 1
  const repository = {
    rebuild: () => ({
      tasks: { task: { status: 'running', activeClaim: { claimId: 'claim', generation } } }
    })
  } as unknown as GitStateRepository
  const monitor = monitorComponentClaim(
    repository,
    {
      workflowRunId: 'run',
      taskId: 'task',
      claimId: 'claim',
      claimGeneration: 1
    } as PreparedAttempt,
    10000
  )
  try {
    expect(monitor.signal.aborted).toBe(false)
    generation = 2
    vi.advanceTimersByTime(1000)
    expect(monitor.signal.aborted).toBe(true)
  } finally {
    monitor.dispose()
    vi.useRealTimers()
  }
})
