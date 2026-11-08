import { afterEach, expect, test } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { BinaryArtifactStorage } from './binary-asset-storage'
import { CreativeDeliveryStore } from './creative-delivery'
import type { MamUiSnapshot } from '../../../shared/mam/ui-projection'
import { ArtifactContractSchema } from '../../../shared/mam/domain/artifact'
import { validateAndEncodeArtifactContent } from './artifact-content-validator'
import { AttemptArtifactValidator } from '../application/attempt-artifact-validator'
import { LocalArtifactStore } from './local-artifact-store'
import { createComponentExecutionPort } from '../components/attempt-component-executor'
import { BinaryAssetStore } from '../creative-runtime'
import type { ComponentExecutionPort } from '../application/component-execution-port'
import type { DesktopCreativeServices } from '../components/desktop-creative-services'

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})
const selection = { workflowRunId: 'run.test', attemptId: 'attempt.test', contractId: 'image' }
test('a fresh Git clone imports the exact submitted files and rejects a tampered transfer', async () => {
  const root = await mkdtemp(join(tmpdir(), 'mam-delivery-'))
  roots.push(root)
  const source = join(root, 'source'),
    target = join(root, 'clone'),
    data = join(root, 'data')
  await mkdir(source)
  const git = (directory: string, ...args: string[]) =>
    execFileSync('git', ['-C', directory, ...args], { encoding: 'utf8', windowsHide: true }).trim()
  git(source, 'init')
  git(source, 'config', 'user.name', 'Test')
  git(source, 'config', 'user.email', 'test@example.invalid')
  const storage = new BinaryArtifactStorage(join(data, 'artifacts', 'binary'))
  const manifest = await storage.import(
    [
      {
        logicalPath: 'image.bin',
        mime: 'application/octet-stream',
        stream: (async function* () {
          yield Buffer.from('actual asset bytes')
        })()
      }
    ],
    { componentId: 'creative.image', componentVersion: '0.3.0', operation: 'image.generate' }
  )
  const contract = ArtifactContractSchema.parse({
    schemaVersion: '1.0.0',
    artifactType: 'image',
    format: 'asset-bundle',
    maxBytes: 1048576
  })
  const bytes = validateAndEncodeArtifactContent(contract, manifest).toString('utf8')
  await writeFile(join(source, 'output.json'), bytes)
  git(source, 'add', 'output.json')
  git(source, 'commit', '-m', 'Submit binary manifest')
  const commit = git(source, 'rev-parse', 'HEAD')
  const snapshot = {
    runs: [
      {
        run: { id: selection.workflowRunId },
        tasks: [
          {
            id: 'task.test',
            title: 'Image',
            inputArtifacts: [],
            outputContracts: [contract]
          }
        ],
        attempts: [
          {
            id: selection.attemptId,
            taskId: 'task.test',
            status: 'submitted',
            result: {
              schemaVersion: '1.0.0',
              summary: 'Generated image',
              verifications: [],
              risks: [],
              followUps: [],
              usage: { status: 'unknown' },
              status: 'submitted',
              system: {
                submittedCommit: commit,
                workflowRunId: selection.workflowRunId,
                nodeRunId: 'node-run.test',
                taskId: 'task.test',
                attemptId: selection.attemptId,
                roleInstanceId: 'role.test',
                executorInvocationId: 'invocation.test',
                effectiveConfigHash: 'a'.repeat(64),
                createdAt: '2026-11-08T00:00:00Z'
              },
              artifacts: [
                {
                  contractId: 'notes',
                  type: 'notes',
                  contentRef: 'notes.md',
                  sha256: 'f'.repeat(64)
                },
                {
                  contractId: 'image',
                  type: 'image',
                  contentRef: 'output.json',
                  sha256: createHash('sha256').update(bytes).digest('hex')
                }
              ]
            }
          }
        ]
      }
    ]
  } as unknown as MamUiSnapshot
  const project = (directory: string) => ({
    directory,
    snapshot,
    readProjectBlob: (ref: string, path: string) =>
      execFileSync('git', ['-C', directory, 'show', `${ref}:${path}`], {
        encoding: 'utf8',
        windowsHide: true
      })
  })
  const exporter = new CreativeDeliveryStore(data, project(source))
  const folder = join(root, 'transfer')
  await exporter.export(selection, folder)
  git(root, 'clone', '--no-local', source, target)
  const importer = new CreativeDeliveryStore(join(root, 'new-data'), project(target))
  expect((await importer.list())[0]?.available).toBe(false)
  const cloneStore = new LocalArtifactStore(join(root, 'new-data', 'artifacts'))
  const validator = new AttemptArtifactValidator(cloneStore)
  type Authorize = Parameters<AttemptArtifactValidator['authorizeComponentInputs']>
  const producer = snapshot.runs[0]!.attempts[0]!
  const claim = producer.result!.artifacts[1]!
  const bundle = { run: { id: selection.workflowRunId } } as Authorize[0]
  const projection = {
    attempts: { [producer.id]: { status: 'submitted', result: producer.result } }
  } as unknown as Authorize[1]
  const task = {
    nodeId: 'consumer',
    inputArtifacts: [{ artifactId: 'image', version: 1, contentHash: claim.sha256 }],
    inputArtifactContext: [
      {
        source: 'workflow',
        producerAttemptId: producer.id,
        artifactType: 'image',
        expectedHash: claim.sha256
      }
    ]
  } as unknown as Authorize[2]
  await expect(validator.authorizeComponentInputs(bundle, projection, task)).rejects.toThrow()
  await importer.import(selection, folder)
  expect((await importer.list())[0]?.available).toBe(true)
  const inputs = await validator.authorizeComponentInputs(bundle, projection, task)
  expect(inputs).toHaveLength(1)
  await importer.import(selection, folder)
  expect(await validator.authorizeComponentInputs(bundle, projection, task)).toEqual(inputs)
  const restored = await cloneStore.readForNode(selection.workflowRunId, 'consumer', inputs[0]!)
  expect(restored.version.attemptId).toBe(producer.id)
  expect(restored.version.taskId).toBe('task.test')
  expect(restored.version.roleInstanceId).toBe('role.test')
  const forgedSnapshot = structuredClone(snapshot)
  forgedSnapshot.runs[0]!.attempts[0]!.result!.system.taskId = 'task.foreign'
  const forged = new CreativeDeliveryStore(join(root, 'forged-data'), {
    ...project(target),
    snapshot: forgedSnapshot
  })
  await expect(forged.import(selection, folder)).rejects.toThrow('authority mismatch')
  const assets = await BinaryAssetStore.open(join(root, 'consumer-assets'))
  let consumed = false
  const services = {
    assets,
    registry: {
      acquireVersion: async () => ({
        manifest: {
          version: '1.0.0',
          hostApiVersion: '2.0.0',
          operations: [{ id: 'image.inspect' }]
        },
        release() {}
      })
    },
    runtimeHandlers: () => () => ({
      validate() {},
      async run(request: { inputAssets: Parameters<typeof assets.read>[0][] }) {
        expect(await assets.read(request.inputAssets[0]!)).toEqual(
          Buffer.from('actual asset bytes')
        )
        consumed = true
        return { text: '# Result\nConsumed transferred input' }
      }
    })
  } as unknown as DesktopCreativeServices
  const authority = {
    workflowRunId: selection.workflowRunId,
    nodeRunId: 'node-run.consumer',
    taskId: 'task.consumer',
    attemptId: 'attempt.consumer',
    roleInstanceId: 'role.consumer',
    executorInvocationId: 'invocation.consumer',
    effectiveConfigHash: 'b'.repeat(64),
    createdAt: '2026-11-08T00:00:00Z'
  }
  const request = {
    authority,
    snapshot: {
      workflowRunId: authority.workflowRunId,
      taskId: authority.taskId,
      attemptId: authority.attemptId,
      contentHash: authority.effectiveConfigHash,
      tools: ['component:creative.image'],
      modelProfile: { id: 'model', version: 1 },
      providerProfile: { id: 'provider', version: 1 },
      execution: {}
    },
    component: {
      id: 'creative.image',
      version: '1.0.0',
      hostApiVersion: '2.0.0',
      operation: 'image.inspect',
      params: {}
    },
    workspace: join(target, 'consumer'),
    nodeId: 'consumer',
    inputArtifacts: inputs,
    outputContracts: [
      ArtifactContractSchema.parse({
        schemaVersion: '1.0.0',
        artifactType: 'consumer.output',
        format: 'markdown',
        maxBytes: 10000,
        requiredSections: ['Result']
      })
    ],
    credentialValues: {},
    signal: new AbortController().signal
  } as unknown as Parameters<ComponentExecutionPort['execute']>[0]
  const execution = await createComponentExecutionPort({
    root: join(root, 'new-data'),
    services: async () => services
  }).execute(request)
  expect(consumed).toBe(true)
  expect(execution.result?.status).toBe('submitted')
  const fresh = new CreativeDeliveryStore(join(root, 'fresh-data'), project(target))
  await writeFile(join(folder, 'files', 'image.bin'), Buffer.from('tamper asset bytes'))
  await expect(fresh.import(selection, folder)).rejects.toThrow('integrity')
  expect((await fresh.list())[0]?.available).toBe(false)
  await expect(fresh.import({ ...selection, attemptId: 'attempt.other' }, folder)).rejects.toThrow(
    'current project'
  )
})
