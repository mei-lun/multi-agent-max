import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { basename, dirname, extname, join, resolve } from 'node:path'
import {
  MamDesignDraftSchema,
  type MamDesignDraft,
  type MamDesignProposal,
  type MamDesignWorkflowRevision
} from '../../../shared/mam/design-assistant'

type MamDesignDraftResetOptions = Readonly<{
  modelProfileId?: string
  workflowRevision?: MamDesignWorkflowRevision
  proposal?: MamDesignProposal
}>

export class MamDesignDraftStore {
  private readonly path: string

  constructor(
    path: string,
    private readonly now: () => string = () => new Date().toISOString()
  ) {
    this.path = resolve(path)
  }

  get(): MamDesignDraft {
    if (!existsSync(this.path)) return this.reset()
    const source = readFileSync(this.path, 'utf8')
    try {
      const parsed = MamDesignDraftSchema.safeParse(JSON.parse(source))
      if (parsed.success) return parsed.data
    } catch (cause) {
      if (!(cause instanceof SyntaxError)) throw cause
    }
    this.archiveCorruptDraft()
    return this.reset()
  }

  save(input: unknown): MamDesignDraft {
    const draft = MamDesignDraftSchema.parse(input)
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 })
    const temporaryPath = `${this.path}.${process.pid}.${randomUUID()}.tmp`
    writeFileSync(temporaryPath, `${JSON.stringify(draft, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
      flag: 'wx'
    })
    renameSync(temporaryPath, this.path)
    return structuredClone(draft)
  }

  reset(input?: string | MamDesignDraftResetOptions): MamDesignDraft {
    const options = typeof input === 'string' ? { modelProfileId: input } : (input ?? {})
    const timestamp = this.now()
    return this.save({
      schemaVersion: '1.0.0',
      id: `design.${randomUUID().replaceAll('-', '')}`,
      ...(options.modelProfileId ? { selectedModelProfileId: options.modelProfileId } : {}),
      ...(options.workflowRevision ? { workflowRevision: options.workflowRevision } : {}),
      messages: [],
      ...(options.proposal ? { proposal: options.proposal } : {}),
      status: 'draft',
      createdAt: timestamp,
      updatedAt: timestamp
    })
  }

  private archiveCorruptDraft(): void {
    renameSync(this.path, this.nextCorruptPath())
  }

  private nextCorruptPath(): string {
    const extension = extname(this.path) || '.json'
    const filename = basename(this.path, extension)
    const timestamp = safeFilenamePart(this.now())
    const prefix = `${filename}.corrupt-${timestamp}`
    let suffix = 1
    let candidate = join(dirname(this.path), `${prefix}${extension}`)
    while (existsSync(candidate)) {
      suffix += 1
      candidate = join(dirname(this.path), `${prefix}.${suffix}${extension}`)
    }
    return candidate
  }
}

function safeFilenamePart(value: string): string {
  const sanitized = value.replaceAll(/[^A-Za-z0-9]/g, '-')
  return sanitized || 'unknown'
}
