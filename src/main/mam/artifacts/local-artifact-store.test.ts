import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ArtifactContractSchema } from '../../../shared/mam/domain/artifact'
import {
  ArtifactStoreError,
  LocalArtifactStore,
  toArtifactRef,
  type ArtifactWriteRequest
} from './local-artifact-store'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true }))
  )
})

describe('LocalArtifactStore', () => {
  it('validates and versions all five Artifact formats', async () => {
    const store = await createStore()
    const jsonContract = contract('profile.json', 'json-schema', {
      jsonSchema: {
        type: 'object',
        properties: { name: { type: 'string' } },
        required: ['name'],
        additionalProperties: false
      }
    })
    const json = await store.put(request('artifact.profile', jsonContract, { name: 'MAM' }))
    const jsonV2 = await store.put(request('artifact.profile', jsonContract, { name: 'MAM v2' }))
    const markdown = await store.put(
      request(
        'artifact.report',
        contract('report.markdown', 'markdown', {
          requiredSections: ['summary', 'evidence']
        }),
        '# Summary\nDone\n\n## Evidence\nTests passed\n',
        [toArtifactRef(json)]
      )
    )
    const fileSet = await store.put(
      request(
        'artifact.files',
        contract('source.files', 'file-set', {
          allowedGlobs: ['src/**/*.ts']
        }),
        { files: [{ path: 'src/a.ts', content: 'export {}\n' }] }
      )
    )
    const diff = await store.put(
      request(
        'artifact.diff',
        contract('source.diff', 'diff'),
        'diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -0,0 +1 @@\n+export {}\n'
      )
    )
    const tests = await store.put(
      request('artifact.tests', contract('tests.report', 'test-report'), {
        framework: 'vitest',
        status: 'passed',
        total: 2,
        passed: 2,
        failed: 0,
        skipped: 0,
        summary: 'all passed'
      })
    )

    expect(json.version).toBe(1)
    expect(jsonV2.version).toBe(2)
    expect(markdown.inputs).toEqual([toArtifactRef(json)])
    expect([json, markdown, fileSet, diff, tests]).toSatisfy((versions: (typeof json)[]) =>
      versions.every(
        (version) =>
          version.validationStatus === 'valid' && /^[0-9a-f]{64}$/.test(version.contentHash)
      )
    )
  })

  it('rejects invalid, missing, and oversized Artifacts', async () => {
    const store = await createStore()
    await expect(
      store.put(
        request(
          'invalid.json',
          contract('profile.json', 'json-schema', {
            jsonSchema: {
              type: 'object',
              properties: { name: { type: 'string' } },
              required: ['name']
            }
          }),
          { name: 42 }
        )
      )
    ).rejects.toThrow(expect.objectContaining({ code: 'artifact_contract_invalid' }))
    await expect(
      store.put(
        request(
          'invalid.markdown',
          contract('report.markdown', 'markdown', { requiredSections: ['summary'] }),
          'no heading'
        )
      )
    ).rejects.toThrow(ArtifactStoreError)
    await expect(
      store.put(
        request(
          'invalid.files',
          contract('source.files', 'file-set', { allowedGlobs: ['src/**/*.ts'] }),
          { files: [{ path: '../secret.env', content: 'secret' }] }
        )
      )
    ).rejects.toThrow(ArtifactStoreError)
    await expect(
      store.put(request('invalid.diff', contract('source.diff', 'diff'), 'not a patch'))
    ).rejects.toThrow(ArtifactStoreError)
    await expect(
      store.put(
        request('invalid.tests', contract('tests.report', 'test-report'), {
          framework: 'vitest',
          status: 'passed',
          total: 2,
          passed: 1,
          failed: 1,
          skipped: 0,
          summary: 'inconsistent'
        })
      )
    ).rejects.toThrow(ArtifactStoreError)
    await expect(
      store.put(
        request(
          'invalid.large',
          contract('tiny.markdown', 'markdown', { requiredSections: ['summary'], maxBytes: 8 }),
          '# Summary\nfar too large'
        )
      )
    ).rejects.toThrow(expect.objectContaining({ code: 'artifact_too_large' }))
  })

  it('enforces declared input scope and detects content tampering', async () => {
    const store = await createStore()
    const version = await store.put(
      request(
        'artifact.secure',
        contract('secure.json', 'json-schema', {
          jsonSchema: { type: 'object', properties: { ok: { const: true } }, required: ['ok'] }
        }),
        { ok: true }
      )
    )
    const reference = toArtifactRef(version)
    await store.registerNodeInputs('run.1', 'consumer', [reference])
    expect(await store.readForNode('run.1', 'consumer', reference)).toMatchObject({
      content: { ok: true }
    })
    await expect(store.readForNode('run.1', 'intruder', reference)).rejects.toThrow(
      expect.objectContaining({ code: 'artifact_access_denied' })
    )

    const missing = { artifactId: 'artifact.missing', version: 1, contentHash: 'f'.repeat(64) }
    await store.registerNodeInputs('run.1', 'consumer-missing', [missing])
    await expect(store.readForNode('run.1', 'consumer-missing', missing)).rejects.toThrow(
      expect.objectContaining({ code: 'artifact_not_found' })
    )

    await writeFile(version.storageRef, '{"ok":false}')
    expect(await store.verify(reference)).toBe(false)
    await expect(store.readForNode('run.1', 'consumer', reference)).rejects.toThrow(
      expect.objectContaining({ code: 'artifact_hash_mismatch' })
    )
  })

  it('restores declared input scope after a process restart', async () => {
    const root = await createRoot()
    const first = new LocalArtifactStore(root, () => '2026-07-22T20:00:00Z')
    const version = await first.put(
      request(
        'artifact.restart',
        contract('restart.json', 'json-schema', {
          jsonSchema: { type: 'object', properties: { ok: { const: true } }, required: ['ok'] }
        }),
        { ok: true }
      )
    )
    const reference = toArtifactRef(version)
    await first.registerNodeInputs('run.1', 'consumer', [reference])

    const restarted = new LocalArtifactStore(root, () => '2026-07-22T20:01:00Z')
    expect(await restarted.readForNode('run.1', 'consumer', reference)).toMatchObject({
      content: { ok: true }
    })
  })
})

async function createStore(): Promise<LocalArtifactStore> {
  return new LocalArtifactStore(await createRoot(), () => '2026-07-22T20:00:00Z')
}

async function createRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'mam-artifact-store-'))
  temporaryDirectories.push(root)
  return root
}

function contract(
  artifactType: string,
  format: 'json-schema' | 'markdown' | 'file-set' | 'diff' | 'test-report',
  extra: Record<string, unknown> = {}
) {
  return ArtifactContractSchema.parse({
    schemaVersion: '1.0.0',
    artifactType,
    format,
    required: true,
    maxBytes: 10_000,
    ...extra
  })
}

function request(
  artifactId: string,
  artifactContract: ReturnType<typeof contract>,
  content: unknown,
  inputs: ArtifactWriteRequest['inputs'] = []
): ArtifactWriteRequest {
  return {
    artifactId,
    artifactType: artifactContract.artifactType,
    workflowRunId: 'run.1',
    nodeRunId: 'node-run.1',
    taskId: 'task.1',
    attemptId: 'attempt.1',
    roleInstanceId: 'role-instance.1',
    contract: artifactContract,
    inputs,
    content
  }
}
