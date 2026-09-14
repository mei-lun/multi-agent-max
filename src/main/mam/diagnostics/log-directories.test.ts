import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { rememberLogDirectory, prunePreviousLogDirectory } from './log-directories'
import { selectLogDirectoryDialog } from './desktop-diagnostic-dialogs'

const { showOpenDialog } = vi.hoisted(() => ({ showOpenDialog: vi.fn() }))
vi.mock('electron', () => ({ app: {}, dialog: { showOpenDialog } }))
const roots: string[] = []
afterEach(() => {
  vi.clearAllMocks()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('log directory selection and retention', () => {
  it('does not block startup when directory history is truncated', () => {
    const root = mkdtempSync(join(tmpdir(), 'mam-log-history-'))
    roots.push(root)
    writeFileSync(join(root, 'log-directories.json'), '[')
    expect(rememberLogDirectory(root, join(root, 'new logs'))).toEqual([join(root, 'diagnostics')])
  })

  it('starts the directory picker at the current path and leaves cancellation unchanged', async () => {
    showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: ['/chosen/logs'] })
    expect(await selectLogDirectoryDialog({} as never, '/current/logs')).toBe('/chosen/logs')
    expect(showOpenDialog).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        defaultPath: '/current/logs',
        properties: ['openDirectory', 'createDirectory']
      })
    )
    showOpenDialog.mockResolvedValueOnce({ canceled: true, filePaths: ['/ignored'] })
    expect(await selectLogDirectoryDialog({} as never, '/current/logs')).toBeUndefined()
  })

  it('remembers earlier destinations across restarts and prunes only expired logs', () => {
    const root = mkdtempSync(join(tmpdir(), 'mam-log-directories-'))
    roots.push(root)
    const mamRoot = join(root, 'mam')
    const first = join(root, 'first')
    const next = join(root, 'next')
    rememberLogDirectory(mamRoot, first)
    expect(rememberLogDirectory(mamRoot, next)).toContain(first)
    expect(rememberLogDirectory(mamRoot, next)).not.toContain(next)
    const invocation = join(first, 'invocations', 'a'.repeat(64))
    mkdirSync(invocation, { recursive: true })
    const old = { at: '2026-09-13T00:00:00Z', message: 'old' }
    const recent = { at: '2026-09-14T00:00:00Z', message: 'recent' }
    writeFileSync(join(first, 'events.json'), JSON.stringify([old, recent]))
    writeFileSync(
      join(first, 'runtime.jsonl'),
      `${JSON.stringify(old)}\n${JSON.stringify(recent)}\n`
    )
    writeFileSync(join(invocation, 'rpc.jsonl'), `${JSON.stringify(old)}\n`)
    writeFileSync(join(first, 'user-file.txt'), 'keep')
    prunePreviousLogDirectory(first, Date.parse('2026-09-14T12:00:00Z'))
    expect(JSON.parse(readFileSync(join(first, 'events.json'), 'utf8'))).toEqual([recent])
    expect(readFileSync(join(first, 'runtime.jsonl'), 'utf8')).not.toContain('old')
    expect(existsSync(join(invocation, 'rpc.jsonl'))).toBe(false)
    expect(readFileSync(join(first, 'user-file.txt'), 'utf8')).toBe('keep')
    expect(existsSync(next)).toBe(false)
  })
})
