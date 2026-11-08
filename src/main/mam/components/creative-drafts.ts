import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  creativeDraftSchema,
  creativeDraftRefSchema,
  type CreativeDraft,
  type CreativeDraftRef
} from '../../../shared/mam/creative-draft'
import { assetRefSchema, type CreativeJob } from '../../../shared/mam/creative-runtime'
import type { BinaryAssetStore, OperationHandler } from '../creative-runtime'
import type { ComponentTaskDescriptor } from '../../../shared/mam/domain/component-task'

export class CreativeDraftStore {
  constructor(
    private readonly root: string,
    private readonly assets: BinaryAssetStore
  ) {}

  async create(projectId: string, job: CreativeJob): Promise<CreativeDraft> {
    if (
      !projectId.startsWith('project:') ||
      job.request.projectId !== projectId ||
      job.request.attempt ||
      job.state !== 'succeeded'
    )
      throw new Error('Completed manual job from the current project required')
    const result = job.events.at(-1)?.data
    if (result && typeof result === 'object' && 'partial' in result && result.partial)
      throw new Error('Partial output cannot become a delivery draft')
    const assets = job.events
      .filter((event) => event.type === 'asset')
      .map((event) => assetRefSchema.parse(event.data))
    for (const ref of assets) await this.assets.read(ref)
    const record = creativeDraftSchema.parse({
      schemaVersion: '1.0.0',
      projectId,
      jobId: job.id,
      componentId: job.request.componentId,
      componentVersion: job.request.componentVersion,
      operation: job.request.operation,
      assets,
      result: result ?? null
    })
    const bytes = Buffer.from(JSON.stringify(record))
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    await mkdir(this.root, { recursive: true })
    try {
      await writeFile(join(this.root, `${sha256}.json`), bytes, { flag: 'wx' })
    } catch (error) {
      if (
        (error as NodeJS.ErrnoException).code !== 'EEXIST' ||
        !(await readFile(join(this.root, `${sha256}.json`))).equals(bytes)
      )
        throw error
    }
    return { ...record, sha256 }
  }

  async read(projectId: string, ref: CreativeDraftRef): Promise<CreativeDraft> {
    const { sha256 } = creativeDraftRefSchema.parse(ref)
    const bytes = await readFile(join(this.root, `${sha256}.json`))
    if (createHash('sha256').update(bytes).digest('hex') !== sha256)
      throw new Error('Draft content hash mismatch')
    const record = creativeDraftSchema.parse(JSON.parse(bytes.toString('utf8')))
    if (record.projectId !== projectId) throw new Error('Draft belongs to another project')
    for (const asset of record.assets) await this.assets.read(asset)
    return { ...record, sha256 }
  }

  async list(projectId: string): Promise<CreativeDraft[]> {
    await mkdir(this.root, { recursive: true })
    const drafts: CreativeDraft[] = []
    for (const name of await readdir(this.root)) {
      if (!/^[a-f0-9]{64}\.json$/.test(name)) continue
      const bytes = await readFile(join(this.root, name))
      const candidate = creativeDraftSchema.parse(JSON.parse(bytes.toString('utf8')))
      if (candidate.projectId === projectId)
        drafts.push(await this.read(projectId, { sha256: name.slice(0, 64) }))
    }
    return drafts
  }

  async handler(projectId: string, component: ComponentTaskDescriptor): Promise<OperationHandler> {
    const load = async () => {
      if (!component.draft) throw new Error('Draft reference required')
      const draft = await this.read(projectId, component.draft)
      if (
        draft.componentId !== component.id ||
        draft.componentVersion !== component.version ||
        draft.operation !== component.operation
      )
        throw new Error('Draft component identity mismatch')
      return draft
    }
    await load()
    return {
      validate: () => {},
      run: async (_request, context) => {
        const draft = await load()
        for (const asset of draft.assets) {
          context.signal.throwIfAborted()
          await context.emit('asset', asset)
        }
        await context.emit('log', { draft: component.draft, sourceJobId: draft.jobId, projectId })
        return draft.result
      }
    }
  }
}
