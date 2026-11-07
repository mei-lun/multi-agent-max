import { it, expect } from 'vitest'
import { mkdtemp, rm, readdir, writeFile, rename } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { BinaryAssetStore, CreativeJobManager } from './index'
import { creativeRequestSchema } from '../../../shared/mam/creative-runtime'

it('cleans failed and oversized streams and rejects malicious refs', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'stream-'))
  try {
    const store = await BinaryAssetStore.open(directory, { maxBytes: 1024 })
    const failed = async function* () {
      yield new Uint8Array(32)
      throw new Error('source failed')
    }
    await expect(store.import(failed(), { mime: 'video/mp4', filename: 'movie' })).rejects.toThrow(
      'source failed'
    )
    const huge = async function* () {
      for (let i = 0; i < 100; i++) yield new Uint8Array(256)
    }
    await expect(store.import(huge(), { mime: 'video/mp4', filename: 'movie' })).rejects.toThrow(
      'size limit'
    )
    expect(await readdir(directory)).toEqual([])
    await expect(
      store.read({
        id: '../../escape',
        sha256: 'a'.repeat(64),
        bytes: 0,
        mime: 'x/y',
        filename: 'x'
      })
    ).rejects.toThrow()
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

it('rejects malformed requests and corrupt restored records', async () => {
  expect(creativeRequestSchema.safeParse({ params: [] }).success).toBe(false)
  const directory = await mkdtemp(join(tmpdir(), 'restore-'))
  try {
    await writeFile(
      join(directory, '12345678-1234-4234-8234-123456789012.json'),
      JSON.stringify({ state: 'unknown', events: [] })
    )
    await expect(
      CreativeJobManager.open({ directory, handlers: () => undefined })
    ).rejects.toThrow()
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

it('requires authorized evidence to reconcile interrupted jobs', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'reconcile-'))
  const id = '12345678-1234-4234-8234-123456789012'
  const request = {
    componentId: 'creative.image',
    componentVersion: '1.0.0',
    operation: 'render',
    projectId: 'p',
    idempotencyKey: 'k',
    inputAssets: [],
    params: {}
  }
  try {
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
    const manager = await CreativeJobManager.open({ directory, handlers: () => undefined })
    const evidence = {
      outcome: 'cancelled' as const,
      actor: 'operator',
      evidence: 'Provider confirms no effects'
    }
    await expect(manager.reconcile(id, evidence, () => false)).rejects.toThrow('unauthorized')
    await manager.reconcile(id, evidence, () => true)
    expect(manager.list()[0]?.state).toBe('cancelled')
    expect(manager.events(id).at(-1)?.type).toBe('reconciled')
    await manager.dispose()
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

it('surfaces asynchronous persistence failure and blocks further acceptance', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'fault-'))
  let finish!: (value: unknown) => void
  let started!: () => void
  const ready = new Promise<void>((resolve) => {
    started = resolve
  })
  const request = {
    componentId: 'creative.image',
    componentVersion: '1.0.0',
    operation: 'render',
    projectId: 'p',
    idempotencyKey: 'k',
    inputAssets: [],
    params: {}
  }
  const moved = `${directory}-moved`
  try {
    const manager = await CreativeJobManager.open({
      directory,
      handlers: () => ({
        validate() {},
        run: async () => {
          started()
          return new Promise((resolve) => {
            finish = resolve
          })
        }
      })
    })
    const id = await manager.submit(request)
    await ready
    await rename(directory, moved)
    await writeFile(directory, 'block-directory')
    finish({ done: true })
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(manager.health().length).toBeGreaterThan(0)
    expect(manager.get(id).state).toBe('running')
    await expect(manager.submit({ ...request, idempotencyKey: 'other' })).rejects.toThrow(
      'unhealthy'
    )
  } finally {
    await rm(directory, { force: true })
    await rm(moved, { recursive: true, force: true })
  }
})
