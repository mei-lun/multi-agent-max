import { createHash } from 'node:crypto'
import { dialog } from 'electron'
import { createReadStream } from 'node:fs'
import { join } from 'node:path'
import type { ComponentToolPortFactory } from '../application/component-tool-port'
import type { DesktopCreativeServices } from './desktop-creative-services'
import { CreativeJobManager } from '../creative-runtime'
import {
  assetRefSchema,
  type AssetRef,
  type CreativeRequest
} from '../../../shared/mam/creative-runtime'
import { createMediaServices } from '../media'
import { createCreativeTextServices } from '../creative-text'
import { createDesktopMusicServices } from '../music-native/desktop'
import { createMusicResourceManager } from '../music-native/resources'
import { coordinateGpuHandler } from './gpu-job-coordinator'
import { LocalArtifactStore } from '../artifacts/local-artifact-store'
import { AssetBundleSchema } from '../../../shared/mam/domain/binary-artifact'
import { decodeImage } from './host-native-assets'
import type { ComponentId } from '../../../shared/mam/components'

export function createComponentTools(options: {
  root: string
  services(): Promise<DesktopCreativeServices>
}): ComponentToolPortFactory {
  return ({ prepared, signal }) => {
    let jobs: CreativeJobManager | undefined,
      disposed = false
    const leases = new Map<string, { release(): void }>()
    const running = new Set<Promise<unknown>>()
    let music: ReturnType<typeof createDesktopMusicServices> | undefined
    const ready = (async () => {
      const services = await options.services()
      const modelRegistry = (request: CreativeRequest) => {
        const binding = prepared.snapshot.componentBindings?.find(
          (item) => item.componentId === request.componentId
        )
        if (!binding?.model || !binding.provider) return undefined
        const model = binding.model,
          provider = binding.provider
        const catalog = {
          models: {
            listActive: () => [model],
            getActive: (id: string) => (id === model.id ? model : undefined)
          },
          providers: { getActive: (id: string) => (id === provider.id ? provider : undefined) }
        }
        const config = {
          catalog,
          assets: services.assets,
          validateImage: decodeImage,
          resolveSecret: (ref: string) => prepared.credentialValues[ref]
        }
        return (
          createMediaServices(config).handlers(request) ??
          createCreativeTextServices(config).handlers(request)
        )
      }
      music = createDesktopMusicServices({
        root: join(
          options.root,
          'workflow-native',
          hash(prepared.workflowRunId + String.fromCharCode(0) + prepared.attemptId)
        ),
        assets: services.assets,
        resources: createMusicResourceManager({ root: join(options.root, 'music') }),
        registry: services.registry
      })
      jobs = await CreativeJobManager.open({
        directory: join(options.root, 'component-tool-attempts', hash(prepared.attemptId)),
        handlers: (request) => {
          const handler = coordinateGpuHandler(
            options.root,
            request.operation,
            modelRegistry(request) ??
              (request.componentId === 'creative.music'
                ? music?.handlers(request)
                : services.handlers(request))
          )
          if (!handler) return undefined
          return {
            validate: (req) => handler.validate(req),
            run: (req, context) => {
              const execution = handler.run(req, context)
              running.add(execution)
              void execution.finally(() => running.delete(execution)).catch(() => {})
              return execution
            }
          }
        },
        validateInputs: async (request) => {
          for (const ref of request.inputAssets) await services.assets.read(ref)
        }
      })
      for (const job of jobs.list()) {
        if (job.request.attempt?.id !== prepared.attemptId)
          throw new Error('Foreign component job persistence')
        if (!['succeeded', 'failed', 'cancelled'].includes(job.state))
          leases.set(
            job.id,
            await services.registry.acquireVersion(
              job.request.componentId as ComponentId,
              job.request.componentVersion
            )
          )
      }
      return services
    })()
    const active = () => {
      signal.throwIfAborted()
      if (disposed) throw new Error('Component tools disposed')
    }
    const owned = (id: string) => {
      const job = jobs!.get(id)
      if (
        job.request.attempt?.id !== prepared.attemptId ||
        job.request.projectId !== prepared.workflowRunId
      )
        throw new Error('Foreign component job')
      return job
    }
    const stop = () => {
      for (const job of jobs?.list() ?? []) void jobs?.cancel(job.id).catch(() => {})
    }
    signal.addEventListener('abort', stop, { once: true })
    return {
      async requestApproval({ request, requestHash, categories }) {
        active()
        const binding = prepared.snapshot.componentBindings?.find(
          (item) => item.componentId === request.componentId
        )
        const redact = (value: string) =>
          value.replace(/Bearer\s+\S+|\b(?:sk|xai|api)-[A-Za-z0-9_-]+/gi, '[redacted]')
        const prompt =
          typeof request.params.prompt === 'string'
            ? redact(request.params.prompt.slice(0, 1500))
            : '(native component operation)'
        const decision = await dialog.showMessageBox({
          type: 'question',
          title: 'Approve component operation',
          message: `${request.componentId}: ${request.operation}`,
          detail: `Role: ${prepared.snapshot.roleProfile.id}\nTask: ${prepared.taskId}\nModel: ${binding?.model?.displayName ?? 'Native engine'}\nCount: ${typeof request.params.count === 'number' ? request.params.count : 1}\nPermissions: ${categories.join(', ')}\nProvider cost is unknown and may be charged.\n\n${prompt}\n\nRequest: ${requestHash}`,
          buttons: ['Reject', 'Approve this operation'],
          defaultId: 0,
          cancelId: 0
        })
        active()
        return decision.response === 1
      },
      async listCapabilities() {
        active()
        const services = await ready
        return (await services.registry.list()).flatMap((item) =>
          item.versions
            .filter((version) => version.enabled && version.status === 'installed')
            .map((version) => ({
              componentId: item.id,
              version: version.manifest.version,
              operations: version.manifest.operations.map((operation) => operation.id)
            }))
        )
      },
      async invoke(request) {
        active()
        if (
          !prepared.snapshot.tools.includes(`component:${request.componentId}`) ||
          /(^|\.)(resources|install|remove|offline|status|hardware)(\.|$)/.test(request.operation)
        )
          throw new Error('Component permission denied')
        const binding = prepared.snapshot.componentBindings?.find(
          (item) => item.componentId === request.componentId
        )
        if (binding?.allowedOperations && !binding.allowedOperations.includes(request.operation))
          throw new Error('Component operation denied')
        if (
          /^(image|video|speech|text|vision)\./.test(request.operation) &&
          (!binding?.model || request.params.modelProfileId !== binding.model.id)
        )
          throw new Error('Frozen component model binding required')
        const services = await ready
        active()
        const lease = await services.registry.acquire(request.componentId)
        try {
          if (!lease.manifest.operations.some((operation) => operation.id === request.operation))
            throw new Error('Component operation unavailable')
          const assets: AssetRef[] = []
          for (const input of request.inputAssets ?? []) {
            const ref = assetRefSchema.parse(input)
            const ownedOutput = jobs!
              .list()
              .some(
                (job) =>
                  job.request.attempt?.id === prepared.attemptId &&
                  job.request.projectId === prepared.workflowRunId &&
                  job.events.some(
                    (event) =>
                      event.type === 'asset' &&
                      JSON.stringify(assetRefSchema.parse(event.data)) === JSON.stringify(ref)
                  )
              )
            if (!ownedOutput) throw new Error('Component asset outside Attempt')
            await services.assets.read(ref)
            assets.push(ref)
          }
          const formal = new LocalArtifactStore(join(options.root, 'artifacts'))
          const context: string[] = []
          for (const ref of request.inputArtifacts) {
            const value = await formal.readForNode(
              prepared.workflowRunId,
              prepared.task.nodeId,
              ref
            )
            if (value.version.format === 'asset-bundle') {
              for (const file of AssetBundleSchema.parse(value.content).files)
                assets.push(
                  await services.assets.import(
                    createReadStream(join(options.root, 'artifacts', 'binary', file.sha256)),
                    { filename: file.logicalPath.split('/').at(-1)!, mime: file.mime }
                  )
                )
            } else
              context.push(
                typeof value.content === 'string' ? value.content : JSON.stringify(value.content)
              )
          }
          const params = structuredClone(request.params)
          if (context.length && typeof params.prompt === 'string')
            params.prompt += `\n\nInput artifacts:\n${context.join('\n\n')}`
          const id = await jobs!.submit({
            componentId: request.componentId,
            componentVersion: lease.manifest.version,
            operation: request.operation,
            projectId: prepared.workflowRunId,
            attempt: { id: prepared.attemptId, serverId: prepared.executorInvocationId },
            idempotencyKey: request.idempotencyKey,
            inputAssets: assets,
            params
          })
          if (leases.has(id)) lease.release()
          else leases.set(id, lease)
          return { jobId: id }
        } catch (error) {
          lease.release()
          throw error
        }
      },
      async status(jobId) {
        active()
        await ready
        const job = owned(jobId),
          assets: AssetRef[] = []
        for (const event of job.events)
          if (event.type === 'asset') {
            const ref = assetRefSchema.parse(event.data)
            assets.push(ref)
          }
        const final = job.events.at(-1)?.data
        const text =
          final && typeof final === 'object' && 'text' in final && typeof final.text === 'string'
            ? final.text
            : undefined
        return { jobId, state: job.state, assets, ...(text ? { text } : {}) }
      },
      async cancel(jobId) {
        active()
        await ready
        owned(jobId)
        await jobs!.cancel(jobId)
      },
      async dispose() {
        disposed = true
        signal.removeEventListener('abort', stop)
        await ready
        await jobs!.dispose()
        await Promise.allSettled(running)
        await music?.dispose()
        for (const lease of leases.values()) lease.release()
        leases.clear()
      }
    }
  }
}
const hash = (value: string) => createHash('sha256').update(value).digest('hex')
