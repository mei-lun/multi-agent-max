import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DesktopRuntimeLogger } from './desktop-runtime-logger'

const directories: string[] = []

afterEach(async () => {
  vi.useRealTimers()
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })))
})

describe('DesktopRuntimeLogger', () => {
  it('rotates bounded local logs while retaining one backup', async () => {
    const path = await logPath()
    const logger = new DesktopRuntimeLogger(path, () => '2026-08-06T12:00:00.000Z', 512)

    logger.record('test', 'first', { value: 'x'.repeat(220) })
    logger.record('test', 'second', { value: 'x'.repeat(220) })
    logger.record('test', 'third', { value: 'x'.repeat(220) })

    const current = await readFile(path, 'utf8')
    const backup = await readFile(`${path}.1`, 'utf8')
    expect(current).toContain('third')
    expect(backup).toContain('second')
    expect(backup).not.toContain('first')
    expect((await stat(path)).size).toBeLessThanOrEqual(512)
    expect((await stat(`${path}.1`)).size).toBeLessThanOrEqual(512)
  })

  it('samples healthy heartbeats once per minute', async () => {
    vi.useFakeTimers({ now: new Date('2026-08-06T12:00:00.000Z') })
    const path = await logPath()
    const logger = new DesktopRuntimeLogger(path)
    const stop = logger.startHeartbeat()

    vi.advanceTimersByTime(59_000)
    expect(existsSync(path)).toBe(false)
    vi.advanceTimersByTime(1_000)
    stop()

    const lines = (await readFile(path, 'utf8')).trim().split('\n')
    expect(lines).toHaveLength(1)
    expect(JSON.parse(lines[0]!)).toMatchObject({
      scope: 'main',
      event: 'heartbeat',
      details: { intervalMs: 1_000, lagMs: 0 }
    })
  })
})

async function logPath(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'mam-runtime-log-'))
  directories.push(directory)
  return join(directory, 'runtime.jsonl')
}
