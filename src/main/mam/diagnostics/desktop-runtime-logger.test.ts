import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
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
  it('keeps a full day of logs and prunes expired records including the legacy backup', async () => {
    const path = await logPath()
    await writeFile(`${path}.1`, JSON.stringify({ at: '2026-08-05T12:00:00.000Z' }) + '\n')
    let now = '2026-08-06T12:00:00.000Z'
    const logger = new DesktopRuntimeLogger(path, () => now)
    expect(existsSync(`${path}.1`)).toBe(false)
    logger.record('test', 'first', { value: 'x'.repeat(6 * 1024 * 1024) })
    now = '2026-08-07T11:59:00.000Z'
    logger.record('test', 'second')
    expect(await readFile(path, 'utf8')).toContain('first')
    now = '2026-08-07T12:00:00.000Z'
    logger.record('test', 'third')
    const current = await readFile(path, 'utf8')
    expect(current).not.toContain('first')
    expect(current).toContain('second')
    expect(current).toContain('third')
  })

  it('redacts secrets in error stacks while preserving their call sites', async () => {
    const path = await logPath()
    const logger = new DesktopRuntimeLogger(path)
    logger.record('ipc', 'error', {
      error: {
        stack:
          'Error: token=private\n at execute (main.js:42)\n mam-canary-secret-provider sk-example12345'
      }
    })
    const content = await readFile(path, 'utf8')
    expect(content).toContain('main.js:42')
    expect(content).not.toMatch(/private|mam-canary-secret|sk-example/)
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
