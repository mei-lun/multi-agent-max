import { spawn, type SpawnOptions, type ChildProcess } from 'node:child_process'
import { mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
export type ModelSpawn = (executable: string, args: string[], options: SpawnOptions) => ChildProcess
export async function runModelLauncher(options: {
  python: string
  script: string
  data: string
  resources: string
  version: string
  request: unknown
  signal: AbortSignal
  spawnProcess?: ModelSpawn
  emit: (value: unknown) => Promise<void>
}) {
  const o = options
  await mkdir(o.data, { recursive: true })
  await rm(join(o.data, 'cancel'), { force: true })
  await writeFile(join(o.data, 'lease'), 'alive')
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    LEVELUP_3D_PARENT_PID: String(process.pid),
    PYTHONNOUSERSITE: '1',
    PYTHONUTF8: '1'
  }
  delete env.PYTHONPATH
  delete env.PYTHONHOME
  const signal = AbortSignal.any([o.signal, AbortSignal.timeout(3600000)])
  signal.throwIfAborted()
  const child = (o.spawnProcess ?? spawn)(
    o.python,
    [
      '-B',
      '-s',
      o.script,
      '--data',
      o.data,
      '--version',
      o.version,
      '--resources',
      o.resources,
      'generate'
    ],
    {
      env,
      windowsHide: true,
      detached: process.platform !== 'win32',
      stdio: ['pipe', 'ignore', 'ignore']
    }
  )
  let killTimer: ReturnType<typeof setTimeout> | undefined
  const abort = () => {
    void writeFile(join(o.data, 'cancel'), 'cancel').catch(() => {})
    killTimer = setTimeout(() => {
      if (process.platform === 'win32' && child.pid) {
        const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
          windowsHide: true,
          stdio: 'ignore'
        })
        killer.on('error', () => child.kill())
      } else if (child.pid) {
        try {
          process.kill(-child.pid, 'SIGKILL')
        } catch {
          child.kill()
        }
      }
    }, 5000)
  }
  signal.addEventListener('abort', abort, { once: true })
  const heartbeat = setInterval(() => {
    void writeFile(join(o.data, 'lease'), 'alive').catch(() => {})
    void readFile(join(o.data, 'operation.json'), 'utf8')
      .then((value) => o.emit(JSON.parse(value)))
      .catch(() => {})
  }, 2000)
  try {
    if (signal.aborted) abort()
    await new Promise<void>((resolve, reject) => {
      child.once('error', () => reject(new Error('3D launcher unavailable')))
      child.once('exit', (code) => (code === 0 ? resolve() : reject(new Error('3D stage failed'))))
      child.stdin?.end(JSON.stringify(o.request))
    })
    signal.throwIfAborted()
    const operation = JSON.parse(await readFile(join(o.data, 'operation.json'), 'utf8'))
    if (operation.status !== 'completed') throw new Error('3D stage did not complete')
    return operation
  } finally {
    clearInterval(heartbeat)
    if (killTimer) clearTimeout(killTimer)
    signal.removeEventListener('abort', abort)
  }
}
