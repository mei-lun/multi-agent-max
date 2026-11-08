import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { assetRefSchema, type AssetRef } from '../../../shared/mam/creative-runtime'
import { assertAncestors } from './registry/persistence'
export class AssetGrants {
  constructor(private directory: string) {}
  async ready() {
    await assertAncestors(this.directory)
    await mkdir(this.directory, { recursive: true })
  }
  private key(project: string, component: string, ref: AssetRef) {
    return path.join(
      this.directory,
      createHash('sha256')
        .update(JSON.stringify([project, component, assetRefSchema.parse(ref)]))
        .digest('hex') + '.json'
    )
  }
  async grant(project: string, component: string, ref: AssetRef) {
    await this.ready()
    const file = this.key(project, component, ref)
    await assertAncestors(file)
    await writeFile(file, JSON.stringify(ref), { flag: 'w', mode: 0o600 })
  }
  async has(project: string, component: string, ref: AssetRef) {
    const file = this.key(project, component, ref)
    await assertAncestors(file)
    try {
      return JSON.stringify(JSON.parse(await readFile(file, 'utf8'))) === JSON.stringify(ref)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
      throw error
    }
  }
  contains(data: unknown, ref: AssetRef): boolean {
    if (!data || typeof data !== 'object') return false
    const parsed = assetRefSchema.safeParse(data)
    if (parsed.success && JSON.stringify(parsed.data) === JSON.stringify(ref)) return true
    return Object.values(data).some((value) => this.contains(value, ref))
  }
}
