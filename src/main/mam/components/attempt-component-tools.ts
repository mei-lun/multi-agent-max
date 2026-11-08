import { attemptModelHandler } from './attempt-model-handler'
import { attemptComponentUsage } from './attempt-usage-budget'
import { registerComponentLedger } from './attempt-component-ledger'
import { componentJobUsage } from './attempt-component-budget'
import { attemptRuntimeContext } from './attempt-runtime-context'
import { approveComponentTool } from './attempt-component-approval'
import { acquireAttemptComponent } from './attempt-component-identity'
import { publishComponentOutputs } from './attempt-component-outputs'
import { assertComponentOperation } from '../application/component-operation-policy'
import { createHash } from 'node:crypto'
import { createReadStream, existsSync } from 'node:fs'
import { join } from 'node:path'
import type { ComponentToolPortFactory } from '../application/component-tool-port'
import type { DesktopCreativeServices } from './desktop-creative-services'
import { CreativeJobManager } from '../creative-runtime'
import { assetRefSchema, type AssetRef } from '../../../shared/mam/creative-runtime'
import { LocalArtifactStore } from '../artifacts/local-artifact-store'
import { AssetBundleSchema } from '../../../shared/mam/domain/binary-artifact'
import type { ComponentId } from '../../../shared/mam/components'

export function createComponentTools(options: {
  root: string
  services(): Promise<DesktopCreativeServices>
}): ComponentToolPortFactory {
  return ({ prepared, authority, signal }) => {
    registerComponentLedger(options.root, authority)
    let jobs: CreativeJobManager | undefined,
      disposed = false
    const leases = new Map<string, { release(): void }>()
    const running = new Set<Promise<unknown>>()
    const identities = new Map<string, Awaited<ReturnType<typeof acquireAttemptComponent>>>()
    const identityDirectory = join(options.root, 'component-identities', hash(prepared.attemptId))
    const ready = (async () => {
      const services = await options.services()
      jobs = await CreativeJobManager.open({
        directory: join(options.root, 'component-tool-attempts', hash(prepared.attemptId)),
        handlers: (request) => {
          const handler =
            attemptModelHandler(
              services,
              options.root,
              prepared,
              authority,
              (id) => jobs?.get(id),
              request
            ) ??
            services.runtimeHandlers(
              attemptRuntimeContext(
                services,
                {
                  catalog: {
                    models: { listActive: () => [], getActive: () => undefined },
                    providers: { getActive: () => undefined }
                  },
                  resolveSecret: () => undefined,
                  scope: hash(prepared.attemptId),
                  lookupJob: (id) => jobs?.get(id)
                },
                {
                  root: options.root,
                  workspace: prepared.worktree.path,
                  snapshot: prepared.snapshot,
                  authority
                }
              )
            )(request)
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
            await acquireAttemptComponent(
              services.registry,
              identityDirectory,
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
      requestApproval: (request) =>
        approveComponentTool(prepared, authority, identityDirectory, active, request),
      async listCapabilities() {
        active()
        const services = await ready
        for (const item of await services.registry.list()) {
          if (!prepared.snapshot.tools.includes(`component:${item.id}`) || identities.has(item.id))
            continue
          if (
            !existsSync(join(identityDirectory, `${item.id}.identity.json`)) &&
            !item.versions.some((v) => v.enabled && v.status === 'installed')
          )
            continue
          identities.set(
            item.id,
            await acquireAttemptComponent(services.registry, identityDirectory, item.id)
          )
        }
        return [...identities].map(([componentId, lease]) => ({
          componentId,
          version: lease.identity.version,
          manifestHash: lease.identity.manifestHash,
          operations: lease.manifest.operations.map((o) => o.id)
        }))
      },
      async invoke(request) {
        active()
        assertComponentOperation(prepared.snapshot, request.componentId, request.operation)
        const binding = prepared.snapshot.componentBindings?.find(
          (item) => item.componentId === request.componentId
        )
        if (
          /^(image|video|speech|text|vision)\./.test(request.operation) &&
          (!binding?.model || request.params.modelProfileId !== binding.model.id)
        )
          throw new Error('Frozen component model binding required')
        const services = await ready
        active()
        const lease = await acquireAttemptComponent(
          services.registry,
          identityDirectory,
          request.componentId
        )
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
          active()
          await attemptComponentUsage(
            options.root,
            prepared.snapshot,
            jobs!.list().some((job) => job.request.idempotencyKey === request.idempotencyKey)
              ? undefined
              : request.operation
          )
          active()
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
        return {
          jobId,
          state: job.state,
          assets,
          ...(text ? { text } : {}),
          usage: componentJobUsage(job, prepared.snapshot)
        }
      },
      async publishOutputs({ jobId, contractIds }) {
        active()
        const services = await ready
        const job = owned(jobId)
        await attemptComponentUsage(options.root, prepared.snapshot)
        const contracts = prepared.task.outputContracts.filter((c) =>
          contractIds.includes(c.artifactType)
        )
        if (new Set(contractIds).size !== contracts.length)
          throw new Error('Output contract not granted')
        return {
          artifacts: await publishComponentOutputs(
            {
              authority: { ...authority, createdAt: new Date().toISOString() },
              workspace: prepared.worktree.path,
              outputContracts: contracts,
              signal
            },
            job,
            services,
            options.root
          )
        }
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
        const services = await ready
        await jobs!.dispose()
        await Promise.allSettled(running)
        await services.releaseRuntimeScope?.(hash(prepared.attemptId))
        for (const lease of identities.values()) lease.release()
        for (const lease of leases.values()) lease.release()
        leases.clear()
      }
    }
  }
}
const hash = (value: string) => createHash('sha256').update(value).digest('hex')
