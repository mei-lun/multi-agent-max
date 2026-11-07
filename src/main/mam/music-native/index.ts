import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { access, mkdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import type { MusicEngine } from '../../../shared/mam/music-native'
import type { HandlerRegistry } from '../creative-runtime/jobs'
import type { BinaryAssetStore } from '../creative-runtime/assets'
import { runMusicJob } from './job-handler'
import { nativeRootCoordinator } from '../components/native-root-coordinator'

const engines: MusicEngine[] = ['musicgen', 'acestep', 'yue2']
const actions = new Set([
  'status',
  'generate',
  'trim',
  'archive',
  'favorite',
  'cancel',
  'import_reference'
])
export type MusicNativeOptions = {
  root: string
  modulesPath: string
  installedEngineRoots: Partial<Record<MusicEngine, string>>
  spawn?: typeof spawn
  timeoutMs?: number
  assets?: BinaryAssetStore
  pollMs?: number
}

export function createMusicNativeServices(options: MusicNativeOptions) {
  const root = resolve(options.root),
    modules = resolve(options.modulesPath)
  const ownership = nativeRootCoordinator(join(root, '.bridge-owner'))
  let ownsRoot = false
  const roots = Object.fromEntries(
    engines.flatMap((e) =>
      options.installedEngineRoots[e] ? [[e, resolve(options.installedEngineRoots[e]!)]] : []
    )
  )
  let child: ChildProcessWithoutNullStreams | undefined
  let fault: Error | undefined,
    disposed = false,
    buffer = Buffer.alloc(0)
  let queue: Promise<unknown> = Promise.resolve()
  let closed: Promise<void> = Promise.resolve()
  let waiting: { resolve(value: unknown): void; reject(error: Error): void } | undefined
  const terminate = () => {
    const process = child
    if (!process) return
    process.stdin.end()
    if (process.pid) {
      if (globalThis.process.platform === 'win32') {
        const killer = spawn('taskkill', ['/PID', String(process.pid), '/T', '/F'], {
          windowsHide: true,
          stdio: 'ignore'
        })
        killer.on('error', () => process.kill())
      } else {
        try {
          globalThis.process.kill(-process.pid, 'SIGKILL')
        } catch {
          process.kill()
        }
      }
    }
  }
  const fail = (message: string) => {
    fault ??= new Error(message)
    waiting?.reject(fault)
    waiting = undefined
    terminate()
  }
  const start = async () => {
    if (child) return
    if (ownership.busy) throw new Error('Music data root already has a native queue')
    const selected = engines.find((e) => roots[e])
    if (!selected) throw new Error('Music runtime not installed')
    const python = join(
      roots[selected]!,
      'runtime',
      globalThis.process.platform === 'win32' ? 'python.exe' : 'bin/python'
    )
    await access(python)
    await access(join(modules, 'bridge.py'))
    await mkdir(root, { recursive: true })
    const env: NodeJS.ProcessEnv = {
      ...globalThis.process.env,
      PYTHONUTF8: '1',
      PYTHONNOUSERSITE: '1',
      LEVELUP_MUSIC_DATA: root,
      LEVELUP_MUSIC_MODELS: roots.musicgen ?? join(root, 'uninstalled-musicgen'),
      LEVELUP_MUSIC_RUNTIME: join(roots.musicgen ?? join(root, 'uninstalled-musicgen'), 'runtime'),
      LEVELUP_MUSIC_ENGINE_ROOTS: JSON.stringify(roots)
    }
    delete env.PYTHONPATH
    delete env.PYTHONHOME
    if (ownership.busy) throw new Error('Music data root already has a native queue')
    ownership.busy = true
    ownsRoot = true
    try {
      child = (options.spawn ?? spawn)(python, ['-u', '-B', '-s', join(modules, 'bridge.py')], {
        env,
        cwd: modules,
        windowsHide: true,
        detached: globalThis.process.platform !== 'win32',
        stdio: 'pipe'
      }) as ChildProcessWithoutNullStreams
    } catch (error) {
      ownership.busy = false
      ownsRoot = false
      throw error
    }
    child.stderr.resume()
    closed = new Promise((resolveClosed) =>
      child!.once('close', () => {
        if (ownsRoot) {
          ownership.busy = false
          ownsRoot = false
        }
        resolveClosed()
      })
    )
    child.on('error', () => fail('Music worker failed; reconciliation required'))
    child.on('exit', () => {
      if (!disposed) fail('Music worker exited; reconciliation required')
    })
    child.stdout.on('data', (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk])
      if (buffer.length > 8 * 1024 * 1024) return fail('Music response exceeds limit')
      const end = buffer.indexOf(10)
      if (end < 0) return
      const line = buffer.subarray(0, end)
      buffer = buffer.subarray(end + 1)
      if (!waiting || buffer.length) return fail('Music response framing lost')
      const receiver = waiting
      waiting = undefined
      try {
        const value = JSON.parse(line.toString('utf8'))
        if (!value || typeof value !== 'object' || !('result' in value || 'error' in value))
          throw new Error()
        if ('error' in value) receiver.reject(new Error('Music operation rejected'))
        else receiver.resolve(value.result)
      } catch {
        receiver.reject(new Error('Invalid music response'))
        fail('Invalid music response')
      }
    })
  }
  const request = (
    action: string,
    body: Record<string, unknown> = {},
    signal?: AbortSignal
  ): Promise<unknown> => {
    const snapshot = structuredClone(body)
    const task = queue.then(async () => {
      if (disposed || fault) throw fault ?? new Error('Music service disposed')
      signal?.throwIfAborted()
      if (!actions.has(action) && action !== 'list') throw new Error('Unsupported music action')
      const line =
        JSON.stringify({ action: action === 'list' ? 'status' : action, request: snapshot }) + '\n'
      if (Buffer.byteLength(line) > 65536) throw new Error('Music request exceeds limit')
      if (!Object.keys(roots).length && action === 'status')
        return {
          ready: false,
          engines: Object.fromEntries(
            engines.map((e) => [e, { ready: false, runtimeReady: false, modelReady: false }])
          ),
          historyAvailable: false,
          reason: 'Music runtime not installed; offline SQLite history adapter not configured'
        }
      await start()
      signal?.throwIfAborted()
      const result = await new Promise<unknown>((resolveResult, reject) => {
        const timeout = setTimeout(
          () => fail('Music request timed out; reconciliation required'),
          options.timeoutMs ?? 90000
        )
        const abort = () => fail('Music request interrupted; reconciliation required')
        signal?.addEventListener('abort', abort, { once: true })
        const cleanup = () => {
          clearTimeout(timeout)
          signal?.removeEventListener('abort', abort)
        }
        waiting = {
          resolve: (value) => {
            cleanup()
            resolveResult(value)
          },
          reject: (error) => {
            cleanup()
            reject(error)
          }
        }
        child!.stdin.write(line, (error) => {
          if (error) fail('Music worker input failed')
        })
      })
      return action === 'list' ? (result as { jobs?: unknown }).jobs : result
    })
    queue = task.catch(() => {})
    return task
  }
  const handlers: HandlerRegistry = (job) => {
    if (!job.operation.startsWith('music.')) return
    const action = job.operation.replace(/^music\.(native\.)?/, '')
    if (
      action === 'import_reference' ||
      (!actions.has(action) && !['list', 'reference', 'export'].includes(action))
    )
      return
    const snapshot = structuredClone(job)
    return {
      validate() {
        if (job.inputAssets.length && action !== 'reference')
          throw new Error('Unexpected music assets')
      },
      run: (_accepted, context) =>
        runMusicJob(
          {
            root,
            call: request,
            ...(options.assets ? { assets: options.assets } : {}),
            ...(options.pollMs ? { pollMs: options.pollMs } : {})
          },
          action,
          snapshot,
          context
        )
    }
  }
  return {
    request,
    handlers,
    dispose: async () => {
      disposed = true
      fail('Music service disposed')
      await queue
      await closed
    }
  }
}
