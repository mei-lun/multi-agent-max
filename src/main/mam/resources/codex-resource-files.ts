import { readFile, readdir } from 'node:fs/promises'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import { isRecord } from './codex-resource-values'

export async function readJson(path: string): Promise<Record<string, unknown> | undefined> {
  try {
    const value: unknown = JSON.parse(await readFile(path, 'utf8'))
    return isRecord(value) ? value : undefined
  } catch {
    return undefined
  }
}

export async function directoryNames(path: string): Promise<string[]> {
  return (await readdir(path, { withFileTypes: true }).catch(() => []))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
}

export function enabledPluginKeys(config: Record<string, unknown>): Set<string> {
  if (!isRecord(config.plugins)) return new Set()
  return new Set(
    Object.entries(config.plugins)
      .filter(([, value]) => !isRecord(value) || value.enabled !== false)
      .map(([key]) => key)
  )
}

export function containedPath(root: string, child: string): string {
  const target = resolve(root, child)
  const traversal = relative(root, target)
  if (traversal === '..' || traversal.startsWith(`..${sep}`) || isAbsolute(traversal)) {
    throw new Error('plugin_path_escape')
  }
  return target
}
