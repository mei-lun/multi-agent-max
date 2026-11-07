import { assetRefSchema, type CreativeJob } from '../../../shared/mam/creative-runtime'
import type { ComponentManifest } from '../../../shared/mam/components'

export function projectMedia(
  jobs: readonly CreativeJob[],
  projectId: string,
  manifest: ComponentManifest,
  kind: 'image' | 'audio' | 'video',
  limit: number
) {
  if (
    !manifest.operations.some((operation) =>
      operation.requiredCapabilities.includes('assets.projectMedia')
    )
  )
    throw new Error('Project media permission unavailable')
  const values = new Map<
    string,
    {
      ref: ReturnType<typeof assetRefSchema.parse>
      prompt: string
      modelId: string
      createdAt: string
    }
  >()
  for (const job of jobs) {
    if (job.request.projectId !== projectId) continue
    for (const event of job.events) {
      if (event.type !== 'asset') continue
      const parsed = assetRefSchema.safeParse(event.data)
      if (!parsed.success || !parsed.data.mime.startsWith(`${kind}/`)) continue
      values.set(parsed.data.id, {
        ref: parsed.data,
        prompt: String(job.request.params.prompt ?? ''),
        modelId: String(job.request.params.modelProfileId ?? ''),
        createdAt: event.at
      })
    }
  }
  const assets = [...values.values()].sort(
    (a, b) => b.createdAt.localeCompare(a.createdAt) || a.ref.id.localeCompare(b.ref.id)
  )
  return { assets: assets.slice(0, limit), total: assets.length }
}
