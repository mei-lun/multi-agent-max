import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ComponentExecutionPort } from '../application/component-execution-port'
import type { DesktopCreativeServices } from './desktop-creative-services'
import { CreativeJobManager } from '../creative-runtime'
import { assetRefSchema, type AssetRef } from '../../../shared/mam/creative-runtime'
import { createMediaServices, type MediaCatalog } from '../media'
import { createCreativeTextServices } from '../creative-text'
import { LocalArtifactStore } from '../artifacts/local-artifact-store'
import { BinaryArtifactStorage } from '../artifacts/binary-asset-storage'
import { AssetBundleSchema } from '../../../shared/mam/domain/binary-artifact'
import { buildAttemptResult } from '../artifacts/attempt-result-builder'
import { validateAndEncodeArtifactContent } from '../artifacts/artifact-content-validator'
import { decodeImage } from './host-native-assets'
import type { ModelProfile, ProviderProfile } from '../../../shared/mam/domain/execution-profile'
import { createDesktopMusicServices } from '../music-native/desktop'
import { createMusicResourceManager } from '../music-native/resources'
import { coordinateGpuHandler } from './gpu-job-coordinator'

type Execution = Parameters<ComponentExecutionPort['execute']>[0]

export function createComponentExecutionPort(options: {
  root: string
  services(): Promise<DesktopCreativeServices>
}): ComponentExecutionPort {
  return {
    execute: async (input) => {
      const { component, snapshot, authority } = input
      if (
        authority.workflowRunId !== snapshot.workflowRunId ||
        authority.taskId !== snapshot.taskId ||
        authority.attemptId !== snapshot.attemptId ||
        authority.effectiveConfigHash !== snapshot.contentHash
      )
        throw new Error('Component authority does not match frozen config')
      if (!snapshot.tools.includes(`component:${component.id}`))
        throw new Error('Component authorization missing')
      if (/\.resources\.|\.status$|\.hardware$/.test(component.operation))
        throw new Error('Component maintenance is a manual workbench operation')
      const services = await options.services()
      const lease = await services.registry.acquireVersion(component.id, component.version)
      let jobs: CreativeJobManager | undefined
      let nativeMusic: ReturnType<typeof createDesktopMusicServices> | undefined
      const executions = new Set<Promise<unknown>>()
      try {
        if (
          lease.manifest.hostApiVersion !== component.hostApiVersion ||
          !lease.manifest.operations.some((operation) => operation.id === component.operation)
        )
          throw new Error('Pinned component operation unavailable')
        const assets: AssetRef[] = []
        const contextInputs: string[] = []
        const formal = new LocalArtifactStore(join(options.root, 'artifacts'))
        for (const reference of input.inputArtifacts) {
          const record = await formal.readForNode(authority.workflowRunId, input.nodeId, reference)
          if (record.version.format !== 'asset-bundle') {
            contextInputs.push(
              typeof record.content === 'string' ? record.content : JSON.stringify(record.content)
            )
            continue
          }
          const bundle = AssetBundleSchema.parse(record.content)
          for (const file of bundle.files)
            assets.push(
              await services.assets.import(
                createReadStream(join(options.root, 'artifacts', 'binary', file.sha256)),
                { mime: file.mime, filename: file.logicalPath.split('/').at(-1)! }
              )
            )
        }
        const media = frozenCatalog(input)
        const generation = createMediaServices({
          ...media,
          assets: services.assets,
          validateImage: decodeImage
        })
        const text = createCreativeTextServices({
          ...media,
          assets: services.assets,
          validateImage: decodeImage
        })
        if (component.id === 'creative.music') {
          nativeMusic = createDesktopMusicServices({
            root: join(
              options.root,
              'workflow-native',
              createHash('sha256')
                .update(authority.workflowRunId + String.fromCharCode(0) + authority.attemptId)
                .digest('hex')
            ),
            assets: services.assets,
            resources: createMusicResourceManager({ root: join(options.root, 'music') }),
            registry: { acquire: (id) => services.registry.acquireVersion(id, component.version) }
          })
        }
        const directory = join(
          options.root,
          'component-attempts',
          createHash('sha256').update(authority.attemptId).digest('hex')
        )
        jobs = await CreativeJobManager.open({
          directory,
          handlers: (request) => {
            const handler = coordinateGpuHandler(
              options.root,
              request.operation,
              generation.handlers(request) ??
                text.handlers(request) ??
                (component.id === 'creative.music'
                  ? nativeMusic?.handlers(request)
                  : services.handlers(request))
            )
            if (!handler) return undefined
            return {
              validate: (request) => handler.validate(request),
              run: (request, context) => {
                const running = handler.run(request, context)
                executions.add(running)
                void running.finally(() => executions.delete(running)).catch(() => {})
                return running
              }
            }
          },
          validateInputs: async (request) => {
            for (const asset of request.inputAssets) await services.assets.read(asset)
          }
        })
        const params = structuredClone(component.params)
        if (contextInputs.length && typeof params.prompt === 'string')
          params.prompt += `\n\nInput artifacts:\n${contextInputs.join('\n\n')}`
        if (/^(image|video|speech|text|vision)\./.test(component.operation))
          params.modelProfileId = snapshot.modelProfile.id
        const id = await jobs.submit({
          componentId: component.id,
          componentVersion: component.version,
          operation: component.operation,
          projectId: authority.workflowRunId,
          attempt: { id: authority.attemptId, serverId: authority.executorInvocationId },
          idempotencyKey: authority.attemptId,
          inputAssets: assets,
          params
        })
        const result = await settled(jobs, id, input.signal)
        const outputs = new Map<string, AssetRef>()
        for (const event of result.events) {
          if (event.type !== 'asset') continue
          const ref = assetRefSchema.parse(event.data)
          await services.assets.read(ref)
          outputs.set(ref.id, ref)
        }
        const final = result.events.at(-1)?.data
        if (final && typeof final === 'object' && 'partial' in final && final.partial)
          throw new Error('Component returned partial output; review retained job results')
        const binaries = new BinaryArtifactStorage(join(options.root, 'artifacts', 'binary'))
        const refs = [...outputs.values()]
        const bundle = refs.length
          ? await binaries.import(
              refs.map((ref, index) => ({
                logicalPath: `${index + 1}-${ref.filename}`,
                mime: ref.mime,
                stream: (async function* () {
                  yield await services.assets.read(ref)
                })()
              })),
              {
                componentId: component.id,
                componentVersion: component.version,
                operation: component.operation
              }
            )
          : undefined
        await mkdir(input.workspace, { recursive: true })
        const claims = []
        for (const [index, contract] of input.outputContracts.entries()) {
          const value =
            contract.format === 'asset-bundle'
              ? bundle
              : contract.format === 'markdown'
                ? textValue(final)
                : final
          if (value === undefined) {
            if (contract.required) throw new Error('Required component output absent')
            continue
          }
          const bytes = validateAndEncodeArtifactContent(contract, value)
          const contentRef = `.mam-component-${createHash('sha256').update(authority.attemptId).digest('hex').slice(0, 16)}-${index}.json`
          await writeFile(join(input.workspace, contentRef), bytes, { flag: 'wx' })
          claims.push({
            contractId: contract.artifactType,
            type: contract.artifactType,
            contentRef,
            sha256: createHash('sha256').update(bytes).digest('hex')
          })
        }
        return {
          invocation: { component, jobId: id },
          events: [],
          usage: { status: 'unknown' },
          stderr: '',
          result: buildAttemptResult(
            {
              schemaVersion: '1.0.0',
              status: 'submitted',
              summary: `Completed ${component.operation}`,
              artifacts: claims,
              verifications: [],
              risks: ['Provider cost is unknown unless reported by the component.'],
              followUps: [],
              usage: { status: 'unknown' }
            },
            authority
          )
        }
      } finally {
        await jobs?.dispose()
        await Promise.allSettled(executions)
        await nativeMusic?.dispose()
        lease.release()
      }
    }
  }
}

function frozenCatalog(input: Execution): {
  catalog: MediaCatalog
  resolveSecret(ref: string): string | undefined
} {
  const { snapshot } = input
  const provider: ProviderProfile = {
    id: snapshot.providerProfile.id,
    version: snapshot.providerProfile.version,
    protocol: snapshot.execution.providerProtocol,
    ...(snapshot.execution.providerBaseUrl ? { baseUrl: snapshot.execution.providerBaseUrl } : {}),
    ...(snapshot.execution.providerSecretRef
      ? { secretRef: snapshot.execution.providerSecretRef }
      : {}),
    ...(snapshot.execution.providerHeaders ? { headers: snapshot.execution.providerHeaders } : {})
  }
  const model: ModelProfile = {
    id: snapshot.modelProfile.id,
    version: snapshot.modelProfile.version,
    displayName: snapshot.execution.remoteModelId,
    providerProfileId: provider.id,
    remoteModelId: snapshot.execution.remoteModelId,
    capabilities: snapshot.execution.modelCapabilities,
    defaultInference: snapshot.execution.inference
  }
  return {
    catalog: {
      models: {
        getActive: (id) => (id === model.id ? model : undefined),
        listActive: () => [model]
      },
      providers: { getActive: (id) => (id === provider.id ? provider : undefined) }
    },
    resolveSecret: (ref) => input.credentialValues[ref]
  }
}

async function settled(jobs: CreativeJobManager, id: string, signal: AbortSignal) {
  const abort = () => {
    void jobs.cancel(id).catch(() => {})
  }
  signal.addEventListener('abort', abort, { once: true })
  try {
    for (;;) {
      if (signal.aborted) {
        await jobs.cancel(id)
        throw new Error('Component task cancelled or timed out')
      }
      const job = jobs.get(id)
      if (job.state === 'succeeded') return job
      if (['failed', 'cancelled', 'reconciliation-required'].includes(job.state))
        throw new Error(`Component task ${job.state}`)
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
  } finally {
    signal.removeEventListener('abort', abort)
  }
}

function textValue(value: unknown): string | undefined {
  if (typeof value === 'string') return value
  return value && typeof value === 'object' && 'text' in value && typeof value.text === 'string'
    ? value.text
    : undefined
}
