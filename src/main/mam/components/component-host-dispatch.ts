import { randomUUID } from 'node:crypto'
import type { ComponentHostRequest } from '../../../shared/mam/component-host-api'
import { decodeImage, importNativeAsset, exportNativeAsset } from './host-native-assets'
import { projectMedia } from './host-project-media'
import type { ComponentBinding, ComponentDispatchContext } from './component-host-context'
import { readAssetText } from './host-asset-access'
import { getConversation, listConversations, runConversation } from './host-conversations'

export async function dispatchComponentRequest(
  context: ComponentDispatchContext,
  binding: ComponentBinding,
  senderId: number,
  request: ComponentHostRequest
) {
  const { options, grants, tools, previews, pin } = context
  const { manifest, projectId } = binding.context
  const settled = new Set(['succeeded', 'failed', 'cancelled'])
  const owns = (id: string) => {
    const job = options.jobs.get(id)
    if (job.request.componentId !== manifest.id || job.request.projectId !== projectId)
      throw new Error('Job outside component context')
    return job
  }
  if (request.action === 'context') return structuredClone(binding.context)
  if (request.action === 'openComponent') return context.open(request.componentId, projectId)
  if (request.action === 'readAssetText')
    return readAssetText(context, binding.context, request.ref, request.maxBytes)
  if (request.action === 'listConversations') return listConversations(context, binding.context)
  if (request.action === 'getConversation')
    return getConversation(context, binding.context, request.conversationId)
  if (request.action === 'runConversation')
    return runConversation(context, binding.context, request)
  if (request.action === 'toolCheck')
    return tools.check(binding.window, manifest, projectId, request.call)
  if (request.action === 'toolExecute')
    return tools.execute(binding.window, manifest, projectId, request.token)
  if (request.action === 'listModels') return options.listModels?.() ?? []
  if (request.action === 'listComponents')
    return (await options.registry.list())
      .filter((item) => item.versions.some((version) => version.enabled))
      .map((item) => ({ id: item.id }))
  if (request.action === 'configureRife') {
    if (manifest.id !== 'creative.spine' || !options.rifeSettings)
      throw new Error('RIFE configuration unavailable')
    return options.rifeSettings.configure(binding.window)
  }
  if (request.action === 'listProjectMedia') {
    const result = projectMedia(
      options.jobs.list(),
      projectId,
      manifest,
      request.kind,
      request.limit
    )
    for (const item of result.assets) {
      await options.assets.read(item.ref)
      await grants.grant(projectId, manifest.id, item.ref)
    }
    return result
  }
  if (request.action === 'storeImage') {
    const bytes = Buffer.from(request.bytes)
    const mime = decodeImage(bytes)
    const ref = await options.assets.import(
      (async function* () {
        yield bytes
      })(),
      { filename: request.filename, mime }
    )
    await grants.grant(projectId, manifest.id, ref)
    return ref
  }
  if (request.action === 'previewAsset' || request.action === 'exportAsset') {
    const ref = request.ref
    const output = options.jobs
      .list()
      .some(
        (j) =>
          j.request.projectId === projectId &&
          j.request.componentId === manifest.id &&
          j.events.some((e) => grants.contains(e.data, ref))
      )
    if (!(await grants.has(projectId, manifest.id, ref)) && !output)
      throw new Error('Asset outside component context')
    await options.assets.read(ref)
    if (request.action === 'exportAsset') {
      return exportNativeAsset(binding.window, options.assets, ref, options.protectedDirectories)
    }
    const token = randomUUID()
    previews.set(token, { sender: senderId, ref })
    return `mam-component://package/__assets/${token}`
  }
  if (request.action === 'listJobs')
    return options.jobs
      .list()
      .filter((j) => j.request.componentId === manifest.id && j.request.projectId === projectId)
  if (request.action === 'events') {
    owns(request.jobId)
    return options.jobs.events(request.jobId, request.afterSequence)
  }
  if (request.action === 'cancel') {
    owns(request.jobId)
    return options.jobs.cancel(request.jobId)
  }
  if (request.action === 'deleteJob') {
    const job = owns(request.jobId)
    if (!settled.has(job.state)) throw new Error('Only terminal jobs can be deleted')
    const retain = async (value: unknown): Promise<void> => {
      const { assetRefSchema } = await import('../../../shared/mam/creative-runtime')
      const parsed = assetRefSchema.safeParse(value)
      if (parsed.success) {
        await grants.grant(projectId, manifest.id, parsed.data)
        return
      }
      if (value && typeof value === 'object')
        for (const child of Object.values(value)) await retain(child)
    }
    for (const event of job.events) await retain(event.data)
    await options.jobs.delete(job.id)
    return true
  }
  if (request.action === 'importAsset') {
    if (request.kind === 'file' && manifest.id !== 'creative.constellation')
      throw new Error('Generic file import unavailable')
    const ref = await importNativeAsset(binding.window, options.assets, request.kind)
    if (!ref) return null
    await grants.grant(projectId, manifest.id, ref)
    return ref
  }
  if (!manifest.operations.some((o) => o.id === request.operation))
    throw new Error('Operation absent from component manifest')
  for (const ref of request.inputAssets) {
    const ownedOutput = options.jobs
      .list()
      .some(
        (j) =>
          j.request.projectId === projectId &&
          j.request.componentId === manifest.id &&
          j.events.some((e) => grants.contains(e.data, ref))
      )
    if (!(await grants.has(projectId, manifest.id, ref)) && !ownedOutput)
      throw new Error('Asset outside component context')
    await options.assets.read(ref)
  }
  const job = {
    ...request,
    componentId: manifest.id,
    componentVersion: manifest.version,
    projectId
  }
  const { action: _action, ...submission } = job
  if (!options.handlers(submission)) throw new Error('No host handler registered for operation')
  const lease = await options.registry.acquireVersion(manifest.id, manifest.version)
  if (lease.manifest.version !== manifest.version) {
    lease.release()
    throw new Error('Component version changed')
  }
  try {
    const id = await options.jobs.submit(submission)
    await pin(id)
    lease.release()
    return id
  } catch (error) {
    lease.release()
    throw error
  }
}
