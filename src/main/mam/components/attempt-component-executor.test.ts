import { createMediaServices } from '../media'
import { decodeImage } from './host-native-assets'
import { test, expect, vi } from 'vitest'
vi.mock('electron', () => ({
  dialog: { showMessageBox: vi.fn(async () => ({ response: 1 })) },
  nativeImage: {
    createFromBuffer: () => ({ isEmpty: () => false, getSize: () => ({ width: 1, height: 1 }) })
  }
}))
import { createServer } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createComponentExecutionPort } from './attempt-component-executor'
import type { ComponentExecutionPort } from '../application/component-execution-port'
import type { DesktopCreativeServices } from './desktop-creative-services'
import { BinaryAssetStore } from '../creative-runtime'
import { LocalArtifactStore } from '../artifacts/local-artifact-store'
import { AttemptArtifactValidator } from '../application/attempt-artifact-validator'
import { ArtifactContractSchema } from '../../../shared/mam/domain/artifact'
import { createComponentTools } from './attempt-component-tools'
import { ComponentToolGateway } from '../application/component-tool-gateway'
import type { PreparedAttempt } from '../application/mam-attempt-execution-types'
import { dialog } from 'electron'
import { acquireAttemptComponent } from './attempt-component-identity'
import type { ComponentRegistry } from './registry'
import { execFileSync } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import { collectPreparedAttemptResult } from '../application/prepared-attempt-result-collector'
import { createGitCommandClient } from '../state-store/git-command-client'
import { AssetBundleSchema } from '../../../shared/mam/domain/binary-artifact'
type Input = Parameters<ComponentExecutionPort['execute']>[0]
export function input(root: string, operation: string, baseUrl: string): Input {
  const authority = {
    workflowRunId: 'run.1',
    nodeRunId: 'node-run.1',
    taskId: 'task.1',
    attemptId: 'attempt.1',
    roleInstanceId: 'role.1',
    executorInvocationId: 'invocation.1',
    effectiveConfigHash: 'a'.repeat(64),
    createdAt: '2026-07-28T23:02:00Z'
  }
  return {
    authority,
    nodeId: 'node.1',
    workspace: join(root, 'workspace'),
    component: {
      id: 'creative.image',
      version: '1.0.0',
      hostApiVersion: '1.0.0',
      operation,
      params: { prompt: 'test' }
    },
    credentialValues: { key: 'frozen-secret' },
    signal: new AbortController().signal,
    inputArtifacts: [],
    outputContracts: [
      ArtifactContractSchema.parse({
        schemaVersion: '1.0.0',
        artifactType: 'binary.output',
        format: 'asset-bundle',
        maxBytes: 10000
      })
    ],
    snapshot: {
      workflowRunId: 'run.1',
      taskId: 'task.1',
      attemptId: 'attempt.1',
      contentHash: authority.effectiveConfigHash,
      tools: ['component:creative.image'],
      providerProfile: { id: 'provider', version: 1 },
      modelProfile: { id: 'model', version: 1 },
      execution: {
        providerProtocol: 'openai-completions',
        providerBaseUrl: baseUrl,
        providerSecretRef: 'key',
        remoteModelId: 'gpt-image-1',
        modelCapabilities: {
          modalities: ['image'],
          supportsTools: false,
          supportsStructuredOutput: false
        },
        inference: {}
      }
    }
  } as unknown as Input
}
test('production image HTTP output reaches formal bundle validator and granted workspace', async () => {
  const root = await mkdtemp(join(tmpdir(), 'component-port-'))
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==',
    'base64'
  )
  let auth = ''
  const server = createServer((req, res) => {
    auth = String(req.headers.authorization)
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ data: [{ b64_json: png.toString('base64') }] }))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const release = vi.fn(),
    assets = await BinaryAssetStore.open(join(root, 'assets'))
  const services = {
    assets,
    registry: {
      acquireVersion: async () => ({
        manifest: {
          version: '1.0.0',
          hostApiVersion: '1.0.0',
          operations: [{ id: 'image.generate' }]
        },
        release
      })
    },
    runtimeHandlers: (context: Parameters<typeof createMediaServices>[0]) =>
      createMediaServices({ ...context, assets, validateImage: decodeImage }).handlers,
    handlers: () => undefined
  } as unknown as DesktopCreativeServices
  try {
    const request = input(
      root,
      'image.generate',
      `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`
    )
    const result = await createComponentExecutionPort({
      root,
      services: async () => services,
      requestApproval: async () => true
    }).execute({
      ...request,
      snapshot: {
        ...request.snapshot,
        permissions: { ...request.snapshot.permissions, requireApprovalFor: ['network'] }
      }
    })
    expect(auth).toBe('Bearer frozen-secret')
    expect(release).toHaveBeenCalledOnce()
    const store = new LocalArtifactStore(join(root, 'artifacts'))
    const validated = await new AttemptArtifactValidator(store).validate({
      result: result.result!,
      outputContracts: request.outputContracts,
      workspacePath: request.workspace,
      workflowRunId: 'run.1',
      nodeRunId: 'node-run.1',
      taskId: 'task.1',
      attemptId: 'attempt.1',
      roleInstanceId: 'role.1',
      inputArtifacts: []
    })
    const version = validated.records[0]!.version,
      reference = {
        artifactId: version.id,
        version: version.version,
        contentHash: version.contentHash
      }
    await store.authorizeNodeInputs('run.1', 'consumer', [reference])
    await store.materializeAssetBundleForNode(
      'run.1',
      'consumer',
      reference,
      join(root, 'consumer')
    )
    expect(await store.verify(reference)).toBe(true)
  } finally {
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
    await rm(root, { recursive: true, force: true })
  }
})
test('abort keeps lease until delayed handler teardown completes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'component-abort-')),
    assets = await BinaryAssetStore.open(join(root, 'assets'))
  let started!: () => void, finish!: () => void
  const running = new Promise<void>((resolve) => {
      started = resolve
    }),
    drain = new Promise<void>((resolve) => {
      finish = resolve
    })
  const release = vi.fn(),
    controller = new AbortController()
  const services = {
    assets,
    registry: {
      acquireVersion: async () => ({
        manifest: {
          version: '1.0.0',
          hostApiVersion: '1.0.0',
          operations: [{ id: 'fixture.render' }]
        },
        release
      })
    },
    runtimeHandlers: () => () => ({
      validate() {},
      async run() {
        started()
        await drain
        throw new Error('stopped')
      }
    })
  } as unknown as DesktopCreativeServices
  try {
    const request = {
      ...input(root, 'fixture.render', 'https://example.invalid'),
      signal: controller.signal
    }
    const executing = createComponentExecutionPort({
      root,
      services: async () => services
    }).execute(request)
    const rejection = expect(executing).rejects.toThrow('cancelled')
    await running
    controller.abort()
    await new Promise((resolve) => setTimeout(resolve, 80))
    expect(release).not.toHaveBeenCalled()
    finish()
    await rejection
    expect(release).toHaveBeenCalledOnce()
  } finally {
    finish?.()
    await rm(root, { recursive: true, force: true })
  }
})
test('Pi component gateway native approval and owned output feed image edit over real HTTP', async () => {
  const root = await mkdtemp(join(tmpdir(), 'component-tool-http-')),
    assets = await BinaryAssetStore.open(join(root, 'assets'))
  const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==',
      'base64'
    ),
    paths: string[] = []
  const server = createServer((req, res) => {
    paths.push(req.url!)
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ data: [{ b64_json: png.toString('base64') }] }))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`,
    release = vi.fn()
  const manifest = {
    version: '1.0.0',
    operations: [{ id: 'image.generate' }, { id: 'image.edit' }]
  }
  const services = {
    assets,
    registry: {
      list: async () => [
        { id: 'creative.image', versions: [{ enabled: true, status: 'installed', manifest }] }
      ],
      acquire: async () => ({ manifest, release }),
      acquireVersion: async () => ({ manifest, release })
    },
    runtimeHandlers: (context: Parameters<typeof createMediaServices>[0]) =>
      createMediaServices({ ...context, assets, validateImage: decodeImage }).handlers,
    handlers: () => undefined
  } as unknown as DesktopCreativeServices
  const direct = input(root, 'image.generate', baseUrl)
  const prepared = {
    workflowRunId: 'run.1',
    attemptId: 'attempt.1',
    taskId: 'task.1',
    executorInvocationId: 'invocation.1',
    task: {
      nodeId: 'node.1',
      inputArtifacts: [],
      outputContracts: [
        ...direct.outputContracts,
        { ...direct.outputContracts[0]!, artifactType: 'binary.second' }
      ]
    },
    worktree: { path: direct.workspace },
    credentialValues: { key: 'secret' },
    snapshot: {
      ...direct.snapshot,
      roleProfile: { id: 'role.1' },
      permissions: { requireApprovalFor: ['network'] },
      componentBindings: [
        {
          componentId: 'creative.image',
          model: {
            id: 'model',
            version: 1,
            displayName: 'Frozen Image',
            providerProfileId: 'provider',
            remoteModelId: 'gpt-image-1',
            capabilities: direct.snapshot.execution.modelCapabilities
          },
          provider: {
            id: 'provider',
            version: 1,
            protocol: 'openai-completions',
            baseUrl,
            secretRef: 'key'
          }
        }
      ]
    }
  } as unknown as PreparedAttempt
  const authority = {
    workflowRunId: 'run.1',
    nodeRunId: 'node-run.1',
    taskId: 'task.1',
    attemptId: 'attempt.1',
    roleInstanceId: 'role.1',
    executorInvocationId: 'invocation.1',
    effectiveConfigHash: 'a'.repeat(64)
  }
  const { nodeRunId: _node, ...context } = authority,
    signal = new AbortController().signal
  const port = createComponentTools({ root, services: async () => services })({
      prepared,
      authority,
      signal
    }),
    audit = vi.fn(),
    gateway = new ComponentToolGateway(prepared, authority, port, signal, audit)
  const call = (method: string, request: unknown) => gateway.execute({ method, request, context })
  try {
    const first = (await call('component.invoke', {
      componentId: 'creative.image',
      operation: 'image.generate',
      params: { prompt: 'test' },
      inputArtifacts: [],
      idempotencyKey: 'first'
    })) as { jobId: string }
    let status: { state: string; assets: unknown[] } | undefined
    for (let i = 0; i < 100; i++) {
      status = (await call('component.status', first)) as unknown as typeof status
      if (status?.state === 'succeeded') break
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    expect(status?.state).toBe('succeeded')
    const second = (await call('component.invoke', {
      componentId: 'creative.image',
      operation: 'image.edit',
      params: { prompt: 'edit' },
      inputArtifacts: [],
      inputAssets: status!.assets,
      idempotencyKey: 'second'
    })) as { jobId: string }
    for (let i = 0; i < 100; i++) {
      status = (await call('component.status', second)) as unknown as typeof status
      if (status?.state === 'succeeded') break
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    expect(status?.state).toBe('succeeded')
    await expect(
      call('component.publishOutputs', { jobId: second.jobId, contractIds: ['ungranted'] })
    ).rejects.toThrow('not granted')
    const published = (await call('component.publishOutputs', {
      jobId: second.jobId,
      contractIds: ['binary.output', 'binary.second']
    })) as { artifacts: unknown[] }
    expect(published.artifacts).toHaveLength(2)
    const formal = new LocalArtifactStore(join(root, 'artifacts'))
    let result!: Awaited<ReturnType<typeof collectPreparedAttemptResult>>['result']
    for (const writePaths of [['.'], []]) {
      const collected = await collectPreparedAttemptResult({
        prepared: {
          ...prepared,
          snapshot: {
            ...prepared.snapshot,
            permissions: { ...prepared.snapshot.permissions, writePaths }
          }
        },
        assistantText: 'Published the generated images.',
        usage: { status: 'unknown' },
        git: createGitCommandClient(),
        authority: direct.authority
      })
      expect(collected.result.artifacts).toHaveLength(2)
      expect(collected.contents.size).toBe(2)
      result = collected.result
    }
    const checked = await new AttemptArtifactValidator(formal).validate({
      result,
      outputContracts: prepared.task.outputContracts,
      workspacePath: direct.workspace,
      workflowRunId: authority.workflowRunId,
      nodeRunId: authority.nodeRunId,
      taskId: authority.taskId,
      attemptId: authority.attemptId,
      roleInstanceId: authority.roleInstanceId,
      inputArtifacts: []
    })
    const version = checked.records[0]!.version
    const reference = {
      artifactId: version.id,
      version: version.version,
      contentHash: version.contentHash
    }
    execFileSync('git', ['init'], { cwd: direct.workspace })
    execFileSync('git', ['add', '.'], { cwd: direct.workspace })
    execFileSync(
      'git',
      [
        '-c',
        'user.name=Test',
        '-c',
        'user.email=test@example.invalid',
        'commit',
        '-m',
        'Publish component claims'
      ],
      { cwd: direct.workspace }
    )
    const downstream = join(root, 'downstream')
    execFileSync('git', ['clone', direct.workspace, downstream], { stdio: 'pipe' })
    await expect(
      formal.readForNode(authority.workflowRunId, 'ungranted', reference)
    ).rejects.toThrow()
    await formal.authorizeNodeInputs(authority.workflowRunId, 'consumer', [reference])
    await formal.materializeAssetBundleForNode(
      authority.workflowRunId,
      'consumer',
      reference,
      join(downstream, 'generated')
    )
    const bundle = AssetBundleSchema.parse(
      (await formal.readForNode(authority.workflowRunId, 'consumer', reference)).content
    )
    expect(await readFile(join(downstream, 'generated', bundle.files[0]!.logicalPath))).toEqual(png)
    expect(paths).toEqual(['/v1/images/generations', '/v1/images/edits'])
    expect(audit).toHaveBeenCalledTimes(2)
    expect(dialog.showMessageBox).toHaveBeenCalled()
    await writeFile(join(direct.workspace, result.artifacts[0]!.contentRef), '{}')
    await expect(
      collectPreparedAttemptResult({
        prepared,
        assistantText: 'done',
        usage: { status: 'unknown' },
        git: createGitCommandClient(),
        authority: direct.authority
      })
    ).rejects.toThrow('Published artifact hash mismatch')
  } finally {
    await port.dispose()
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
    await rm(root, { recursive: true, force: true })
  }
})

test('task port rejects forbidden, denied, stale authority and aborted approval before execution', async () => {
  const root = await mkdtemp(join(tmpdir(), 'component-policy-'))
  const handler = vi.fn()
  const release = vi.fn()
  const services = {
    registry: {
      acquireVersion: async () => ({
        manifest: {
          version: '1.0.0',
          hostApiVersion: '1.0.0',
          operations: [{ id: 'image.generate' }]
        },
        release
      })
    },
    runtimeHandlers: handler
  } as unknown as DesktopCreativeServices
  const approval = vi.fn(async () => false),
    audit = vi.fn()
  const port = createComponentExecutionPort({
    root,
    services: async () => services,
    requestApproval: approval,
    audit
  })
  const request = input(root, 'image.generate', 'https://example.invalid')
  request.snapshot = {
    ...request.snapshot,
    permissions: { ...request.snapshot.permissions, requireApprovalFor: ['network'] },
    componentBindings: [{ componentId: 'creative.image', allowedOperations: ['image.edit'] }]
  } as Input['snapshot']
  try {
    await expect(port.execute(request)).rejects.toThrow('operation_denied')
    expect(approval).not.toHaveBeenCalled()
    request.snapshot = { ...request.snapshot, componentBindings: [] }
    await expect(
      port.execute({
        ...request,
        authority: { ...request.authority, effectiveConfigHash: 'b'.repeat(64) }
      })
    ).rejects.toThrow('authority')
    expect(approval).not.toHaveBeenCalled()
    await expect(port.execute(request)).rejects.toThrow('approval_denied')
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        allowed: false,
        requestHash: expect.stringMatching(/^[a-f0-9]{64}$/)
      })
    )
    const controller = new AbortController()
    await expect(
      createComponentExecutionPort({
        root,
        services: async () => services,
        requestApproval: async () => {
          controller.abort()
          return true
        }
      }).execute({ ...request, signal: controller.signal })
    ).rejects.toThrow()
    expect(handler).not.toHaveBeenCalled()
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('persisted attempt identity survives upgrades and rejects replacement manifest', async () => {
  const root = await mkdtemp(join(tmpdir(), 'component-identity-'))
  let active = '1.0.0',
    changed = false
  const exact = vi.fn(async (_id: string, version: string) => ({
    manifest: { version, files: { 'runtime.js': changed ? 'b' : 'a' } },
    release: vi.fn()
  }))
  const registry = {
    acquire: () => exact('creative.image', active),
    acquireVersion: exact
  } as unknown as ComponentRegistry
  try {
    const first = await acquireAttemptComponent(registry, root, 'creative.image')
    first.release()
    active = '2.0.0'
    const resumed = await acquireAttemptComponent(registry, root, 'creative.image')
    resumed.release()
    expect(resumed.identity).toEqual(first.identity)
    expect(exact).toHaveBeenLastCalledWith('creative.image', '1.0.0')
    changed = true
    await expect(acquireAttemptComponent(registry, root, 'creative.image')).rejects.toThrow(
      'manifest mismatch'
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
