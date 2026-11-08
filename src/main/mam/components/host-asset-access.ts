import type { AssetRef } from '../../../shared/mam/creative-runtime'
import type { ComponentDispatchContext, ComponentHostContext } from './component-host-context'

export async function assertComponentAsset(
  context: Pick<ComponentDispatchContext, 'options' | 'grants'>,
  binding: ComponentHostContext,
  ref: AssetRef
): Promise<void> {
  const { options, grants } = context
  const output = options.jobs
    .list()
    .some(
      (job) =>
        job.request.projectId === binding.projectId &&
        job.request.componentId === binding.manifest.id &&
        job.events.some((event) => grants.contains(event.data, ref))
    )
  if (!(await grants.has(binding.projectId, binding.manifest.id, ref)) && !output)
    throw new Error('Asset outside component context')
}

export async function readAssetText(
  context: Pick<ComponentDispatchContext, 'options' | 'grants'>,
  binding: ComponentHostContext,
  ref: AssetRef,
  maxBytes: number
): Promise<{ text: string }> {
  await assertComponentAsset(context, binding, ref)
  if (ref.bytes > Math.min(maxBytes, 1048576))
    throw new Error('Text resource exceeds the 1 MiB limit')
  if (
    !/\.(txt|md|markdown|json|csv|tsv|xml|yaml|yml|log|html|css|js|ts|py|rs|c|cpp|h|sql)$/i.test(
      ref.filename
    )
  )
    throw new Error('此文件格式不支持读取正文，请导入 UTF-8 文本 / Unsupported text format')
  const bytes = await context.options.assets.read(ref)
  if (bytes.includes(0)) throw new Error('Binary content cannot be used as text')
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes) }
  } catch {
    throw new Error('Text resource must be valid UTF-8')
  }
}
