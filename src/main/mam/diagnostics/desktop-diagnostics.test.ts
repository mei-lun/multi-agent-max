import { EventEmitter } from 'node:events'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { app, type BrowserWindow } from 'electron'
import { attachWindowDiagnostics, startDesktopLogging } from './desktop-diagnostics'
import { DiagnosticsRecorder } from './diagnostics-recorder'

vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events')
  return { app: Object.assign(new EventEmitter(), { getVersion: () => '0.1.8' }) }
})

const directories: string[] = []
afterEach(() => {
  app.emit('will-quit')
  app.removeAllListeners()
  vi.restoreAllMocks()
  vi.useRealTimers()
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('desktop diagnostic capture', () => {
  it('persists renderer and process errors and expires idle logs while the app remains open', () => {
    vi.useFakeTimers({ now: new Date('2026-09-14T12:00:00Z') })
    const root = mkdtempSync(join(tmpdir(), 'mam-desktop-diagnostics-'))
    directories.push(root)
    const processHandlers = new Map<string, (...args: unknown[]) => void>()
    vi.spyOn(process, 'on').mockImplementation((event, handler) => {
      if (typeof event === 'string') processHandlers.set(event, handler)
      return process
    })
    const logger = startDesktopLogging(root)
    const window = Object.assign(new EventEmitter(), { webContents: new EventEmitter() })
    const eventsPath = join(root, 'diagnostics', 'events.json')
    const diagnostics = new DiagnosticsRecorder(eventsPath)
    const brokenDirectory = join(root, 'broken logs')
    const oldDirectory = join(root, 'old logs')
    mkdirSync(brokenDirectory)
    mkdirSync(oldDirectory)
    writeFileSync(join(brokenDirectory, 'events.json'), '[')
    writeFileSync(
      join(oldDirectory, 'events.json'),
      JSON.stringify([{ at: '2026-09-12T00:00:00Z' }])
    )
    attachWindowDiagnostics(window as unknown as BrowserWindow, logger, diagnostics, () => [], [
      brokenDirectory,
      oldDirectory
    ])
    expect(JSON.parse(readFileSync(join(oldDirectory, 'events.json'), 'utf8'))).toEqual([])
    window.webContents.emit('console-message', {
      level: 'error',
      message: 'TypeError: broken\n at App.tsx:42',
      sourceId: 'App.tsx',
      lineNumber: 42
    })
    processHandlers.get('unhandledRejection')!(new Error('Unhandled token=private'))
    processHandlers.get('uncaughtExceptionMonitor')!(new Error('Fatal error'), 'uncaughtException')
    diagnostics.record({
      at: new Date().toISOString(),
      workflowRunId: 'run.1',
      nodeId: 'node.1',
      roleInstanceId: 'role.1',
      executorInvocationId: 'invocation.1',
      kind: 'executor',
      payload: { message: 'old' }
    })
    const path = join(root, 'diagnostics', 'runtime.jsonl')
    const content = readFileSync(path, 'utf8')
    expect(content).toContain('App.tsx:42')
    expect(content).toContain('unhandled_rejection')
    expect(content).toContain('uncaught_exception')
    expect(content).toContain('0.1.8')
    expect(content).not.toContain('private')
    window.emit('closed')
    vi.setSystemTime(new Date('2026-09-15T12:00:00Z'))
    vi.advanceTimersByTime(60_000)
    expect(JSON.parse(readFileSync(eventsPath, 'utf8'))).toEqual([])
    expect(readFileSync(path, 'utf8')).not.toContain('App.tsx:42')
  })
})
