import { z } from 'zod'
import * as fs from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import {
  componentManifestSchema,
  componentIdSchema,
  versionSchema,
  type ComponentManifest
} from '../../../../shared/mam/components'

export const stateSchema = z
  .object({
    schemaVersion: z.literal(1),
    installed: z.array(
      z
        .object({
          manifest: componentManifestSchema,
          verification: z.literal('trusted-local-import')
        })
        .strict()
    ),
    active: z.partialRecord(componentIdSchema, versionSchema)
  })
  .strict()
  .refine(
    (s) =>
      new Set(s.installed.map((r) => `${r.manifest.id}@${r.manifest.version}`)).size ===
      s.installed.length
  )
export type State = z.infer<typeof stateSchema>
// Storage is private to this process; ancestor checks do not defend concurrent external renames.
export async function assertAncestors(target: string) {
  const absolute = path.resolve(target)
  let current = path.parse(absolute).root
  for (const segment of absolute.slice(current.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, segment)
    try {
      if ((await fs.lstat(current)).isSymbolicLink())
        throw new Error('Unsafe storage ancestor symlink')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }
}
export async function verifyPackage(root: string, manifest: ComponentManifest) {
  await assertAncestors(root)
  for (const [relative, expected] of Object.entries(manifest.files)) {
    let current = root
    if (!(await fs.lstat(current)).isDirectory() || (await fs.lstat(current)).isSymbolicLink())
      throw new Error('Unsafe installed directory')
    for (const segment of relative.split('/')) {
      current = path.join(current, segment)
      if ((await fs.lstat(current)).isSymbolicLink()) throw new Error('Unsafe installed symlink')
    }
    const stat = await fs.lstat(current)
    if (
      !stat.isFile() ||
      stat.size > 32 * 1024 * 1024 ||
      createHash('sha256')
        .update(await fs.readFile(current))
        .digest('hex') !== expected
    )
      throw new Error('Installed package integrity mismatch')
  }
}
export function validateActive(state: State) {
  for (const [id, version] of Object.entries(state.active)) {
    const manifest = state.installed.find(
      (r) => r.manifest.id === id && r.manifest.version === version
    )?.manifest
    if (!manifest || manifest.dependencies.some((d) => state.active[d.id] !== d.version))
      throw new Error('Invalid active component dependency state')
  }
}
