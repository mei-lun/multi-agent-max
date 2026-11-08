import { it, expect } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CreativeJobManager } from './index'
import { creativeJobSchema, type CreativeRequest } from '../../../shared/mam/creative-runtime'

const request: CreativeRequest = {
  componentId: 'creative.image',
  componentVersion: '1.0.0',
  operation: 'generate',
  projectId: 'p',
  idempotencyKey: 'key',
  inputAssets: [],
  params: {}
}
it('isolates callbacks and rejects mutations after disposal', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'lifecycle-'))
  try {
    const manager = await CreativeJobManager.open({
      directory,
      handlers: (candidate) => {
        candidate.projectId = 'changed'
        return {
          validate(input) {
            input.idempotencyKey = 'changed'
          },
          async run() {
            return {}
          }
        }
      },
      validateInputs: async (input) => {
        input.params.changed = true
      }
    })
    const id = await manager.submit(request)
    expect(manager.get(id).request).toEqual(request)
    await manager.dispose()
    await expect(manager.cancel(id)).rejects.toThrow('disposed')
    await expect(manager.delete(id)).rejects.toThrow('disposed')
    await expect(
      manager.reconcile(id, { outcome: 'cancelled', actor: 'a', evidence: 'e' }, () => true)
    ).rejects.toThrow('disposed')
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
it('rejects mismatched terminal history', () => {
  expect(
    creativeJobSchema.safeParse({
      id: '12345678-1234-4234-8234-123456789012',
      request,
      state: 'succeeded',
      events: [{ sequence: 1, type: 'accepted', at: new Date().toISOString() }]
    }).success
  ).toBe(false)
})
it('rejects failed input asset verification before accepting work', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'verify-'))
  try {
    const manager = await CreativeJobManager.open({
      directory,
      handlers: () => ({
        validate() {},
        async run() {
          throw new Error('must not run')
        }
      }),
      validateInputs: async () => {
        throw new Error('Missing asset')
      }
    })
    await expect(manager.submit(request)).rejects.toThrow('Missing asset')
    expect(manager.list()).toEqual([])
    await manager.dispose()
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
