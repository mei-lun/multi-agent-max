import { DatabaseSync } from 'node:sqlite'
import { lstat } from 'node:fs/promises'
import { join } from 'node:path'
import { assertAncestors } from '../components/registry/persistence'

export async function musicHistory(
  root: string,
  change?: { id: string; field: 'favorite' | 'archived'; value: boolean }
) {
  const file = join(root, 'library.sqlite3')
  await assertAncestors(file)
  try {
    if (!(await lstat(file)).isFile()) throw new Error('Invalid music database')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT' && !change) return []
    throw error
  }
  const db = new DatabaseSync(file, { readOnly: !change, allowExtension: false })
  try {
    if (change) {
      if (!/^[a-f0-9]{32}$/.test(change.id) || typeof change.value !== 'boolean')
        throw new Error('Invalid library update')
      db.exec('BEGIN IMMEDIATE')
      const row = db.prepare('SELECT data FROM jobs WHERE id=?').get(change.id)
      if (!row || typeof row.data !== 'string') throw new Error('Unknown music job')
      const value = JSON.parse(row.data)
      if (value.id !== change.id) throw new Error('Corrupt music record')
      value[change.field] = change.value
      db.prepare('UPDATE jobs SET data=? WHERE id=?').run(JSON.stringify(value), change.id)
      db.exec('COMMIT')
    }
    return db
      .prepare('SELECT id,data FROM jobs')
      .all()
      .map((row) => {
        if (typeof row.data !== 'string' || row.data.length > 16 * 1024 * 1024)
          throw new Error('Invalid music history')
        const value = JSON.parse(row.data)
        if (!value || value.id !== row.id) throw new Error('Corrupt music history')
        return value as Record<string, unknown>
      })
      .sort((a, b) => Number(b.created_at ?? 0) - Number(a.created_at ?? 0))
  } finally {
    db.close()
  }
}
