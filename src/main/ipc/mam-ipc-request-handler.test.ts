import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DesktopRuntimeLogger } from '../mam/diagnostics/desktop-runtime-logger'
import { mamIpcRequestHandler } from './mam-ipc-request-handler'

const { handlers } = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => Promise<unknown>>()
}))
vi.mock('electron', () => ({
  ipcMain: {
    handle: (name: string, handler: (...args: unknown[]) => Promise<unknown>) =>
      handlers.set(name, handler)
  }
}))
const directories: string[] = []
afterEach(() => {
  handlers.clear()
  for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true })
})

describe('IPC error diagnostics', () => {
  it('correlates concurrent requests and captures errors without dumping request secrets or prompts', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mam-ipc-logs-'))
    directories.push(root)
    const path = join(root, 'runtime.jsonl')
    const logger = new DesktopRuntimeLogger(path)
    const failure = Object.assign(
      new Error('Git failed', { cause: new Error('token=private-token') }),
      { code: 'git_failed', exitCode: 128, stderr: 'fatal: missing ref' }
    )
    mamIpcRequestHandler(logger)('start', async (_event, value) => {
      if ((value as { taskId: string }).taskId === 'task.fail') throw failure
      return 'ok'
    })
    const handler = handlers.get('start')!
    const results = await Promise.allSettled([
      handler(
        {},
        {
          workflowRunId: 'run.1',
          taskId: 'task.fail',
          apiKey: 'private-key',
          prompt: 'private-prompt'
        }
      ),
      handler({}, { workflowRunId: 'run.1', taskId: 'task.ok' })
    ])
    expect(results[0]).toMatchObject({ status: 'rejected', reason: failure })
    const content = readFileSync(path, 'utf8')
    expect(content).not.toMatch(/private-key|private-token|private-prompt/)
    const entries = content
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line))
    const failed = entries.find((entry) => entry.event === 'error')
    expect(failed.details).toMatchObject({
      taskId: 'task.fail',
      workflowRunId: 'run.1',
      error: {
        code: 'git_failed',
        exitCode: 128,
        stderr: 'fatal: missing ref',
        stack: expect.stringContaining('Git failed'),
        cause: { message: 'token=[REDACTED]' }
      }
    })
    expect(
      entries
        .filter((entry) => entry.details.requestId === failed.details.requestId)
        .map((entry) => entry.event)
    ).toEqual(['request', 'error'])
    expect(new Set(entries.map((entry) => entry.details.requestId)).size).toBe(2)
  })
})
