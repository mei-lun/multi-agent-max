import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { dialog } from 'electron'
import type { MediaCatalog } from '../media'
import type { BinaryAssetStore } from '../creative-runtime/assets'
import type { HandlerRegistry, OperationHandler } from '../creative-runtime/jobs'
import {
  creativeRequestSchema,
  type CreativeJob,
  type CreativeRequest
} from '../../../shared/mam/creative-runtime'
import { componentIdSchema } from '../../../shared/mam/components'
import type { ComponentRegistry } from './registry'
import type { RifeSettings } from './host-rife-settings'
import { packageAssets } from './package-assets'
import { resolveHostVideoReceipt } from './host-video-receipts'
import { PackageProcess } from './package-process'
import type { createBackgroundCapabilities } from './host-background-capabilities'
import { executePackageRenderer } from './package-renderer'
import { packageDataScope } from './package-data-scope'

export type PackageRuntimeContext = {
  catalog: MediaCatalog
  resolveSecret(reference: string): string | undefined
  lookupJob?: (id: string) => CreativeJob | undefined
  scope?: string
  invokeCapability?: (
    ...args: Parameters<ReturnType<typeof createBackgroundCapabilities>>
  ) => Promise<unknown>
}
type Context = Parameters<OperationHandler['run']>[1]
export function createPackageRuntime(options: {
  root: string
  registry: ComponentRegistry
  assets: BinaryAssetStore
  rifeSettings: RifeSettings
  invokeCapability?: ReturnType<typeof createBackgroundCapabilities>
}) {
  const processes = new Map<string, PackageProcess>()
  let disposed = false
  const snapshot = (media: PackageRuntimeContext, request?: CreativeRequest) => {
    const receipt =
      request?.operation === 'video.refresh' && media.lookupJob
        ? resolveHostVideoReceipt(media.lookupJob, String(request.params.sourceJobId), request)
        : undefined
    const selected = request
      ? media.catalog.models.getActive(String(request.params.modelProfileId))
      : undefined
    const models = receipt
      ? [receipt.model]
      : request && request.operation !== 'constellation.graph.execute'
        ? selected
          ? [selected]
          : []
        : [...media.catalog.models.listActive()]
    const providers = receipt
      ? [receipt.provider]
      : models.flatMap((model) => media.catalog.providers.getActive(model.providerProfileId) ?? [])
    const provider = providers[0]
    return structuredClone({
      models,
      providers,
      receipt,
      secret: request && provider?.secretRef ? media.resolveSecret(provider.secretRef) : undefined,
      secrets: request
        ? Object.fromEntries(
            providers.flatMap((provider) =>
              provider.secretRef
                ? [[provider.secretRef, media.resolveSecret(provider.secretRef)]]
                : []
            )
          )
        : {}
    })
  }
  async function invoke(
    request: CreativeRequest,
    media: PackageRuntimeContext,
    frozen: ReturnType<typeof snapshot>,
    context: Context,
    listModels = false
  ) {
    if (disposed) throw new Error('Package runtime disposed')
    const lease = await options.registry.acquireVersion(
      componentIdSchema.parse(request.componentId),
      request.componentVersion
    )
    try {
      const manifest = lease.manifest
      if (manifest.hostApiVersion !== '2.0.0')
        throw new Error('Install a component package with backend API 2.0.0')
      if (!manifest.runtimeEntrypoint || !manifest.files[manifest.runtimeEntrypoint])
        throw new Error('Package backend entrypoint missing')
      if (!listModels && !manifest.operations.some((op) => op.id === request.operation))
        throw new Error('Operation absent from pinned package')
      const scope = packageDataScope(options.root, request.projectId, media.scope, listModels)
      const key = `${manifest.id}:${manifest.version}:${scope.key}`
      let child = processes.get(key)
      if (!child?.alive) {
        if (processes.size >= 128) throw new Error('Package process limit reached')
        child = new PackageProcess(join(lease.packageDirectory, manifest.runtimeEntrypoint))
        processes.set(key, child)
      }
      const assets = packageAssets(options.assets, request.inputAssets)
      let events = 0
      return await child.invoke(
        {
          ...frozen,
          request,
          listModels,
          packageDirectory: lease.packageDirectory,
          resourceRoot: options.root,
          root: scope.root,
          rife:
            request.operation === 'spine.rife.frame' ? await options.rifeSettings.get() : undefined
        },
        context.signal,
        async (method, value) => {
          context.signal.throwIfAborted()
          if (method.startsWith('asset.')) return assets.call(method, value)
          if (method === 'spine.render')
            return executePackageRenderer(options.registry, request, value, context.signal)
          const invokeCapability = media.invokeCapability ?? options.invokeCapability
          if (
            (method.startsWith('graph.') || method === 'operation.authorize') &&
            invokeCapability
          ) {
            if (
              (method === 'graph.conversation' ||
                method === 'graph.authorize' ||
                method === 'operation.authorize') &&
              value &&
              typeof value === 'object' &&
              'inputAssets' in value
            )
              for (const ref of Array.isArray(value.inputAssets) ? value.inputAssets : [])
                assets.check(ref)
            return invokeCapability(request, method, value, context)
          }
          if (method === 'event') {
            const event = value as { type: 'usage' | 'asset' | 'log'; data: unknown }
            if (
              !['usage', 'asset', 'log'].includes(event?.type) ||
              ++events > 100000 ||
              Buffer.byteLength(JSON.stringify(event)) > 24 * 1024 * 1024
            )
              throw new Error('Package event limit')
            if (event.type === 'asset') assets.check(event.data)
            await context.emit(event.type, event.data)
            return null
          }
          if (
            method === 'dialog.directory' &&
            !request.attempt &&
            ['music.resources.offline', 'model3d.resources.offline'].includes(request.operation)
          )
            return dialog.showOpenDialog({
              properties: ['openDirectory'],
              title: 'Import offline component resources'
            })
          throw new Error('Package capability denied')
        }
      )
    } finally {
      lease.release()
    }
  }
  const runtimeHandlers =
    (media: PackageRuntimeContext): HandlerRegistry =>
    (request) => {
      const accepted = creativeRequestSchema.parse(request) as CreativeRequest
      const frozen = snapshot(media, accepted)
      return { validate: () => {}, run: (_, context) => invoke(accepted, media, frozen, context) }
    }
  return {
    runtimeHandlers,
    async releaseRuntimeScope(scope: string) {
      const suffix = `:${createHash('sha256').update(scope).digest('hex')}`
      for (const [key, child] of processes)
        if (key.endsWith(suffix)) {
          await child.dispose()
          processes.delete(key)
        }
    },
    async listModels(media: PackageRuntimeContext) {
      const catalog = await options.registry.list()
      const installed = catalog.flatMap((entry) =>
        entry.versions
          .filter(
            (v) => v.enabled && v.status === 'installed' && v.manifest.hostApiVersion === '2.0.0'
          )
          .map((v) => v.manifest)
      )
      const results = await Promise.all(
        installed.map((manifest) =>
          invoke(
            {
              componentId: manifest.id,
              componentVersion: manifest.version,
              operation: 'catalog.models',
              projectId: 'catalog',
              idempotencyKey: 'catalog',
              inputAssets: [],
              params: {}
            },
            media,
            snapshot(media),
            { signal: new AbortController().signal, emit: async () => {} },
            true
          )
        )
      )
      return [
        ...new Map(
          results.flatMap((result) => result as { id: string }[]).map((model) => [model.id, model])
        ).values()
      ]
    },
    async dispose() {
      disposed = true
      await Promise.all([...processes.values()].map((child) => child.dispose()))
      processes.clear()
    }
  }
}
