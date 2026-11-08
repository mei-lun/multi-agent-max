import { readdir, lstat } from 'node:fs/promises'
import { join } from 'node:path'

// Blender's Windows archive includes a stdlib Python suitable for the original controller.
export async function rigPython(directory: string): Promise<string> {
  const blender = join(directory, 'blender')
  for (const version of (await readdir(blender)).sort().reverse()) {
    if (!/^\d+\.\d+$/.test(version)) continue
    const candidate = join(blender, version, 'python', 'bin', 'python.exe')
    try {
      const stat = await lstat(candidate)
      if (stat.isFile() && !stat.isSymbolicLink()) return candidate
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }
  throw new Error('Bundled Blender Python unavailable; reinstall Blender resources')
}
