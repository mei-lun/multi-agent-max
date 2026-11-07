import { test, expect } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { musicHistory } from './history'
import { parseMusicGpus } from './hardware'
test('history survives absent runtime, preserves metadata and updates only library flag', async () => {
  const root = await mkdtemp(join(tmpdir(), 'music-history-')),
    id = 'a'.repeat(32)
  try {
    const db = new DatabaseSync(join(root, 'library.sqlite3'))
    db.exec('CREATE TABLE jobs (id TEXT PRIMARY KEY, data TEXT NOT NULL)')
    const job = {
      id,
      created_at: 123,
      status: 'succeeded',
      warnings: ['retained'],
      params: { seed: 42 }
    }
    db.prepare('INSERT INTO jobs VALUES (?,?)').run(id, JSON.stringify(job))
    db.close()
    expect(await musicHistory(root)).toEqual([job])
    await musicHistory(root, { id, field: 'favorite', value: true })
    expect(await musicHistory(root)).toEqual([{ ...job, favorite: true }])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
test('GPU CSV matches upstream shape and rejects malformed numeric data', () => {
  expect(parseMusicGpus('GPU, 8192, 4096, 555')).toEqual([
    { name: 'GPU', totalMiB: 8192, freeMiB: 4096, driver: '555' }
  ])
  expect(parseMusicGpus('GPU, N/A, 4096, 555')).toEqual([])
})
