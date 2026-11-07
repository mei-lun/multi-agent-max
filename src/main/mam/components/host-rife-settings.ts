import { dialog, type BrowserWindow } from 'electron'
import { lstat, realpath } from 'node:fs/promises'
import { join } from 'node:path'
import { atomicJson, readSafe } from '../creative-runtime/storage'
import type { RifeConfig } from '../spine-native/rife'

export class RifeSettings {
  constructor(private root: string) {}
  async get(): Promise<RifeConfig | undefined> {
    try {
      const value: unknown = JSON.parse(
        (await readSafe(join(this.root, 'rife.json'))).toString('utf8')
      )
      if (
        !value ||
        typeof value !== 'object' ||
        !('executable' in value) ||
        !('modelDirectory' in value) ||
        typeof value.executable !== 'string' ||
        typeof value.modelDirectory !== 'string'
      )
        throw new Error('Invalid RIFE settings')
      return { executable: value.executable, modelDirectory: value.modelDirectory }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
      throw error
    }
  }
  async configure(window: BrowserWindow): Promise<{ configured: boolean }> {
    const executable = await dialog.showOpenDialog(window, {
      title: '选择 RIFE 程序 / Choose RIFE executable',
      properties: ['openFile']
    })
    const file = executable.filePaths[0]
    if (executable.canceled || !file) return { configured: false }
    const model = await dialog.showOpenDialog(window, {
      title: '选择 RIFE 模型目录 / Choose RIFE model directory',
      properties: ['openDirectory']
    })
    const directory = model.filePaths[0]
    if (model.canceled || !directory) return { configured: false }
    if (!(await lstat(file)).isFile() || (await lstat(file)).isSymbolicLink())
      throw new Error('Invalid RIFE executable')
    for (const name of ['flownet.bin', 'flownet.param']) {
      const stat = await lstat(join(directory, name))
      if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Invalid RIFE model directory')
    }
    await atomicJson(join(this.root, 'rife.json'), {
      executable: await realpath(file),
      modelDirectory: await realpath(directory)
    })
    return { configured: true }
  }
}
