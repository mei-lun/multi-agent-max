import { describe, it, expect } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BinaryAssetStore, CreativeJobManager } from './index'
import type { CreativeRequest } from '../../../shared/mam/creative-runtime'

const request: CreativeRequest = {
  componentId: 'creative.image',
  componentVersion: '1.0.0',
  operation: 'render',
  projectId: 'p',
  idempotencyKey: 'k',
  inputAssets: [],
  params: {}
}
describe('creative persistence', () => {
  it('preserves bytes, hashes deterministically and detects tampering', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'assets-'))
    try {
      const store = await BinaryAssetStore.open(directory)
      const source = async function* () {
        yield Buffer.from([0, 255, 10, 0])
      }
      const first = await store.import(source(), { mime: 'image/png', filename: '../x.png' })
      const second = await store.import(source(), { mime: 'image/png', filename: 'x.png' })
      expect(first.sha256).toBe(second.sha256)
      expect([...(await (await BinaryAssetStore.open(directory)).read(first))]).toEqual([
        0, 255, 10, 0
      ])
      await writeFile(join(directory, `${first.sha256}.blob`), 'tampered')
      await expect(store.read(first)).rejects.toThrow('integrity')
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
  it('serializes duplicate acceptance, retains replay and reconciles late cancelled results', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'jobs-'))
    let finish!: (value: unknown) => void
    let started!: () => void
    const ready = new Promise<void>((resolve) => {
      started = resolve
    })
    const handlers = () => ({
      validate() {},
      run: async () => {
        started()
        return new Promise((resolve) => {
          finish = resolve
        })
      }
    })
    try {
      const manager = await CreativeJobManager.open({ directory, handlers })
      const ids = await Promise.all([manager.submit(request), manager.submit(request)])
      expect(ids[0]).toBe(ids[1])
      await expect(manager.submit({ ...request, params: { changed: true } })).rejects.toThrow(
        'conflict'
      )
      await ready
      await manager.cancel(ids[0])
      finish({ output: 'late' })
      await new Promise((resolve) => setTimeout(resolve, 20))
      expect(manager.get(ids[0]).state).toBe('reconciliation-required')
      const replay: number[] = []
      manager.subscribe(ids[0], 1, (event) => replay.push(event.sequence))()
      expect(replay).toEqual([2, 3, 4])
      await manager.dispose()
      const reopened = await CreativeJobManager.open({ directory, handlers })
      expect(reopened.events(ids[0])).toHaveLength(4)
      await reopened.delete(ids[0])
      expect(() => reopened.get(ids[0])).toThrow()
      await reopened.dispose()
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
  it('never re-executes interrupted work on restart', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'restart-'))
    try {
      const id = '12345678-1234-4234-8234-123456789012'
      await writeFile(
        join(directory, `${id}.json`),
        JSON.stringify({
          id,
          request,
          state: 'running',
          events: [
            { sequence: 1, type: 'accepted', at: new Date().toISOString() },
            { sequence: 2, type: 'running', at: new Date().toISOString() }
          ]
        })
      )
      const manager = await CreativeJobManager.open({
        directory,
        handlers: () => {
          throw new Error('must not execute')
        }
      })
      expect(manager.get(id).state).toBe('reconciliation-required')
      await manager.dispose()
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})
