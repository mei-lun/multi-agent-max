import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { z } from 'zod'
import {
  ResourceHealthResultSchema,
  type ResourceHealthResult
} from '../../../shared/mam/resource-health'

const HealthFileSchema = z
  .object({
    schemaVersion: z.literal('1.0.0'),
    results: z.array(ResourceHealthResultSchema)
  })
  .strict()

export class ResourceHealthStore {
  private readonly path: string

  constructor(path: string) {
    this.path = resolve(path)
  }

  list(): readonly ResourceHealthResult[] {
    if (!existsSync(this.path)) return []
    return HealthFileSchema.parse(JSON.parse(readFileSync(this.path, 'utf8'))).results
  }

  save(results: readonly ResourceHealthResult[]): void {
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 })
    const temporary = `${this.path}.${process.pid}.${randomUUID()}.tmp`
    writeFileSync(temporary, `${JSON.stringify({ schemaVersion: '1.0.0', results }, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
      flag: 'wx'
    })
    renameSync(temporary, this.path)
  }
}
