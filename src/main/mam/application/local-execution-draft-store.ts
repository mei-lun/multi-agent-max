import { randomUUID } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  unlinkSync,
  writeFileSync
} from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import {
  LocalExecutionDraftSchema,
  type LocalExecutionDraft
} from '../../../shared/mam/local-execution-draft'

export class LocalExecutionDraftStore {
  private readonly root: string

  constructor(root: string) {
    this.root = resolve(root)
  }

  get(draftId: string): LocalExecutionDraft | undefined {
    const path = this.path(draftId)
    if (!existsSync(path)) return undefined
    return LocalExecutionDraftSchema.parse(JSON.parse(readFileSync(path, 'utf8')))
  }

  save(input: unknown): LocalExecutionDraft {
    const draft = LocalExecutionDraftSchema.parse(input)
    const path = this.path(draft.id)
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
    const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`
    writeFileSync(temporaryPath, `${JSON.stringify(draft, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
      flag: 'wx'
    })
    renameSync(temporaryPath, path)
    return structuredClone(draft)
  }

  remove(draftId: string): void {
    const path = this.path(draftId)
    if (existsSync(path)) unlinkSync(path)
  }

  listRecoverable(): readonly LocalExecutionDraft[] {
    return this.listUnfinished().filter((draft) => draft.state !== 'needs_attention')
  }

  listUnfinished(): readonly LocalExecutionDraft[] {
    if (!existsSync(this.root)) return []
    return readdirSync(this.root, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
      .flatMap((entry) => {
        try {
          const draft = LocalExecutionDraftSchema.parse(
            JSON.parse(readFileSync(join(this.root, entry.name), 'utf8'))
          )
          return ['delivered', 'discarded', 'stale_claim'].includes(draft.state) ? [] : [draft]
        } catch {
          return []
        }
      })
      .sort(
        (left, right) =>
          left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id)
      )
  }

  private path(draftId: string): string {
    const safe = basename(draftId)
    if (safe !== draftId) throw new Error('local_execution_draft_id_invalid')
    return join(this.root, `${safe}.json`)
  }
}
