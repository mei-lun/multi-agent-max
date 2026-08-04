import { existsSync, mkdirSync, realpathSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { MamLocalSettingsStore } from './mam-local-settings-store'
import type { ProfileCatalog } from './profile-catalog'

export const BUILTIN_PI_EXECUTOR_ID = 'executor.pi'

export function ensureBuiltinPiProfile(
  catalog: ProfileCatalog,
  settings: MamLocalSettingsStore,
  configRoot: string
): void {
  if (!catalog.executors.getActive(BUILTIN_PI_EXECUTOR_ID)) {
    catalog.executors.save({
      id: BUILTIN_PI_EXECUTOR_ID,
      version: 1,
      kind: 'pi-rpc',
      executableRef: 'pi',
      adapterOptions: { mode: 'rpc' }
    })
  }
  const current = settings.get()
  const existing = current.executorBindings.find(
    (item) =>
      item.executorProfileId === BUILTIN_PI_EXECUTOR_ID &&
      item.bindingIdentity === current.bindingIdentity
  )
  if (existing && existsSync(existing.executablePath)) return
  const executablePath = resolveBundledPiCli()
  if (!executablePath) return
  mkdirSync(configRoot, { recursive: true, mode: 0o700 })
  settings.save({
    ...current,
    executorBindings: [
      ...current.executorBindings.filter(
        (item) =>
          item.executorProfileId !== BUILTIN_PI_EXECUTOR_ID ||
          item.bindingIdentity !== current.bindingIdentity
      ),
      {
        id: existing?.id ?? 'binding.executor.pi',
        executorProfileId: BUILTIN_PI_EXECUTOR_ID,
        executablePath,
        configRoot,
        bindingIdentity: current.bindingIdentity
      }
    ]
  })
}

function resolveBundledPiCli(): string | undefined {
  try {
    const packageEntry = fileURLToPath(import.meta.resolve('@earendil-works/pi-coding-agent'))
    const cliPath = join(dirname(packageEntry), 'cli.js')
    const unpackedPath = cliPath.replace(
      `${join('app.asar', '')}`,
      `${join('app.asar.unpacked', '')}`
    )
    const availablePath = existsSync(unpackedPath) ? unpackedPath : cliPath
    return existsSync(availablePath) ? realpathSync(availablePath) : undefined
  } catch {
    return undefined
  }
}
