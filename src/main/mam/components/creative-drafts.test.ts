import { test, expect, vi } from 'vitest'
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { execFileSync } from 'node:child_process'
import { BinaryAssetStore, CreativeJobManager } from '../creative-runtime'
import { CreativeDraftStore } from './creative-drafts'
import { creativeProjectScope } from './creative-project-scope'
import { createComponentExecutionPort } from './attempt-component-executor'
import type { DesktopCreativeServices } from './desktop-creative-services'
import type { ComponentExecutionPort } from '../application/component-execution-port'
import { ArtifactContractSchema } from '../../../shared/mam/domain/artifact'
import { AttemptArtifactValidator } from '../application/attempt-artifact-validator'
import { LocalArtifactStore } from '../artifacts/local-artifact-store'
import { AssetBundleSchema } from '../../../shared/mam/domain/binary-artifact'

test('manual job draft is immutable, project scoped, and becomes formal text and binary outputs over Git', async () => {
  const root = await mkdtemp(join(tmpdir(), 'manual-delivery-'))
  const assets = await BinaryAssetStore.open(join(root, 'assets'))
  const projectId = creativeProjectScope(root)
  const bytes = Buffer.from('manual-media-result')
  const asset = await assets.import(
    (async function* () {
      yield bytes
    })(),
    { mime: 'application/octet-stream', filename: 'result.bin' }
  )
  const jobs = await CreativeJobManager.open({
    directory: join(root, 'jobs'),
    handlers: () => ({
      validate() {},
      async run(_request, context) {
        await context.emit('asset', asset)
        return { text: '# Result\nManual work' }
      }
    })
  })
  const store = new CreativeDraftStore(join(root, 'creative-drafts'), assets)
  try {
    const id = await jobs.submit({
      componentId: 'creative.image',
      componentVersion: '1.0.0',
      operation: 'image.generate',
      projectId,
      idempotencyKey: 'manual',
      inputAssets: [],
      params: {}
    })
    await vi.waitFor(() => expect(jobs.get(id).state).toBe('succeeded'))
    const saved = await store.create(projectId, jobs.get(id))
    const ref = { sha256: saved.sha256 }
    await expect(store.create('project:foreign', jobs.get(id))).rejects.toThrow('current project')
    await expect(store.read('project:foreign', ref)).rejects.toThrow('another project')
    expect(await store.list(projectId)).toHaveLength(1)
    const runtimeHandlers = vi.fn(() => {
      throw new Error('Must not regenerate')
    })
    const services = {
      assets,
      runtimeHandlers,
      registry: {
        acquireVersion: async () => ({
          manifest: {
            version: '1.0.0',
            hostApiVersion: '1.0.0',
            operations: [{ id: 'image.generate' }]
          },
          release() {}
        })
      }
    } as unknown as DesktopCreativeServices
    const authority = {
      workflowRunId: 'run.1',
      nodeRunId: 'node-run.1',
      taskId: 'task.1',
      attemptId: 'attempt.1',
      roleInstanceId: 'role.1',
      executorInvocationId: 'invocation.1',
      effectiveConfigHash: 'a'.repeat(64),
      createdAt: '2026-11-08T00:00:00Z'
    }
    const input = {
      authority,
      nodeId: 'node.1',
      workspace: join(root, 'workspace'),
      projectDirectory: root,
      component: {
        id: 'creative.image',
        version: '1.0.0',
        hostApiVersion: '1.0.0',
        operation: 'image.generate',
        params: {},
        draft: ref
      },
      credentialValues: {},
      signal: new AbortController().signal,
      inputArtifacts: [],
      outputContracts: [
        ArtifactContractSchema.parse({
          schemaVersion: '1.0.0',
          artifactType: 'binary.output',
          format: 'asset-bundle',
          maxBytes: 10000
        }),
        ArtifactContractSchema.parse({
          schemaVersion: '1.0.0',
          artifactType: 'text.output',
          format: 'markdown',
          maxBytes: 10000,
          requiredSections: ['Result']
        })
      ],
      snapshot: {
        workflowRunId: authority.workflowRunId,
        taskId: authority.taskId,
        attemptId: authority.attemptId,
        contentHash: authority.effectiveConfigHash,
        tools: ['component:creative.image'],
        modelProfile: { id: 'model', version: 1 }
      }
    } as unknown as Parameters<ComponentExecutionPort['execute']>[0]
    const port = createComponentExecutionPort({ root, services: async () => services })
    await expect(
      port.execute({ ...input, projectDirectory: join(root, 'foreign') })
    ).rejects.toThrow('another project')
    const result = await port.execute(input)
    expect(runtimeHandlers).not.toHaveBeenCalled()
    const formal = new LocalArtifactStore(join(root, 'artifacts'))
    const checked = await new AttemptArtifactValidator(formal).validate({
      result: result.result!,
      outputContracts: input.outputContracts,
      workspacePath: input.workspace,
      ...authority,
      inputArtifacts: []
    })
    expect(checked.records).toHaveLength(2)
    const version = checked.records.find(
      (record) => record.version.format === 'asset-bundle'
    )!.version
    const reference = {
      artifactId: version.id,
      version: version.version,
      contentHash: version.contentHash
    }
    const git = (args: string[], cwd = input.workspace) =>
      execFileSync('git', args, { cwd, stdio: 'pipe' })
    git(['init'])
    git(['add', '.'])
    git([
      '-c',
      'user.name=Test',
      '-c',
      'user.email=test@example.invalid',
      'commit',
      '-m',
      'Formal draft outputs'
    ])
    const downstream = join(root, 'downstream')
    git(['clone', input.workspace, downstream])
    await expect(formal.readForNode('run.1', 'ungranted', reference)).rejects.toThrow()
    await formal.authorizeNodeInputs('run.1', 'consumer', [reference])
    await formal.materializeAssetBundleForNode(
      'run.1',
      'consumer',
      reference,
      join(downstream, 'assets')
    )
    const bundle = AssetBundleSchema.parse(
      (await formal.readForNode('run.1', 'consumer', reference)).content
    )
    expect(await readFile(join(downstream, 'assets', bundle.files[0]!.logicalPath))).toEqual(bytes)
    await writeFile(join(root, 'creative-drafts', `${saved.sha256}.json`), '{}')
    await expect(store.read(projectId, ref)).rejects.toThrow('hash mismatch')
  } finally {
    await jobs.dispose()
    await rm(root, { recursive: true, force: true })
  }
})
