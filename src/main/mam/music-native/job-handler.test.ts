import { test, expect } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import { BinaryAssetStore } from '../creative-runtime/assets'
import { runMusicJob } from './job-handler'

test('generation waits for native success and publishes hash-checked audio', async () => {
  const root = await mkdtemp(join(tmpdir(), 'music-completion-')),
    id = 'a'.repeat(32)
  const wav = Buffer.from('RIFF0000WAVEdata')
  await mkdir(join(root, 'outputs', id), { recursive: true })
  await writeFile(join(root, 'outputs', id, 'audio.wav'), wav)
  const assets = await BinaryAssetStore.open(join(root, 'assets'))
  const events: unknown[] = []
  let polls = 0
  const job = {
    componentId: 'creative.music',
    componentVersion: '1',
    projectId: 'p',
    operation: 'music.generate',
    idempotencyKey: 'k',
    params: {},
    inputAssets: []
  }
  try {
    const result = await runMusicJob(
      {
        root,
        assets,
        pollMs: 1,
        call: async (action) =>
          action === 'generate'
            ? { id, status: 'queued' }
            : [
                {
                  id,
                  status: ++polls > 1 ? 'succeeded' : 'running',
                  sha256: createHash('sha256').update(wav).digest('hex')
                }
              ]
      },
      'generate',
      job,
      {
        signal: new AbortController().signal,
        emit: async (_type, data) => {
          events.push(data)
        }
      }
    )
    expect(polls).toBe(2)
    expect(events).toHaveLength(2)
    expect(result).toHaveProperty('assets')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('cancelled polling sends native cancel and never publishes success', async () => {
  const controller = new AbortController(),
    calls: string[] = []
  const job = {
    componentId: 'creative.music',
    componentVersion: '1',
    projectId: 'p',
    operation: 'music.generate',
    idempotencyKey: 'k',
    params: {},
    inputAssets: []
  }
  await expect(
    runMusicJob(
      {
        root: '.',
        call: async (action) => {
          calls.push(action)
          return { id: 'a'.repeat(32) }
        }
      },
      'generate',
      job,
      {
        signal: controller.signal,
        emit: async () => {
          controller.abort()
        }
      }
    )
  ).rejects.toThrow()
  expect(calls).toEqual(['generate', 'cancel'])
})
