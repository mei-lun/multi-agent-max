import { dialog, type BrowserWindow } from 'electron'
import type { BinaryAssetStore } from '../creative-runtime'
import type { ComponentManifest } from '../../../shared/mam/components'
import type { ConstellationCall } from '../../../shared/mam/constellation-tools'
import { createConstellationTools } from './constellation-tools'

export class ConstellationToolSessions {
  private sessions = new Map<number, ReturnType<typeof createConstellationTools>>()
  constructor(
    private root: string,
    private assets: BinaryAssetStore
  ) {}
  private get(window: BrowserWindow, manifest: ComponentManifest) {
    if (
      manifest.id !== 'creative.constellation' ||
      !manifest.operations.some((operation) =>
        operation.requiredCapabilities.includes('tools.manual')
      )
    )
      throw new Error('Local tool permission unavailable')
    let gateway = this.sessions.get(window.webContents.id)
    if (!gateway) {
      gateway = createConstellationTools({
        root: this.root,
        assets: this.assets,
        chooseWorkspace: async () => {
          const result = await dialog.showOpenDialog(window, {
            title: '选择星图工具工作目录 / Choose tool workspace',
            properties: ['openDirectory']
          })
          return result.canceled ? undefined : result.filePaths[0]
        },
        requestApproval: async ({ call, workspace }) => {
          const result = await dialog.showMessageBox(window, {
            type: 'question',
            title: '执行本地命令 / Run local command',
            message: call.name === 'run_command' ? call.args.command : call.name,
            detail: `工作目录 / Workspace: ${workspace ?? ''}`,
            buttons: ['取消 / Cancel', '执行 / Run'],
            defaultId: 0,
            cancelId: 0
          })
          return result.response === 1
        }
      })
      this.sessions.set(window.webContents.id, gateway)
      const key = window.webContents.id
      window.once('closed', () => this.sessions.delete(key))
    }
    return gateway
  }
  check(
    window: BrowserWindow,
    manifest: ComponentManifest,
    projectId: string,
    call: ConstellationCall
  ) {
    return this.get(window, manifest).check(call, {
      componentId: manifest.id,
      projectId,
      windowId: window.webContents.id
    })
  }
  execute(window: BrowserWindow, manifest: ComponentManifest, projectId: string, token: string) {
    return this.get(window, manifest).execute(token, {
      componentId: manifest.id,
      projectId,
      windowId: window.webContents.id
    })
  }
}
