import { dialog, ipcMain, type BrowserWindow } from 'electron'
import { z } from 'zod'
import { componentIdSchema, versionSchema } from '../../shared/mam/components'
import { MAM_CREATIVE_CHANNEL } from '../../shared/mam/creative-api'
import { desktopCreativeServices } from '../mam/components/desktop-creative-services'
import {
  creativeFactory,
  type DesktopMediaDependencies
} from '../mam/components/desktop-creative-factory'
import { assertTrustedRenderer } from './trusted-renderer-ipc'

const requestSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('list') }).strict(),
  z.object({ action: z.literal('install') }).strict(),
  z.object({ action: z.literal('enable'), id: componentIdSchema, version: versionSchema }).strict(),
  z.object({ action: z.literal('disable'), id: componentIdSchema }).strict(),
  z.object({ action: z.literal('remove'), id: componentIdSchema, version: versionSchema }).strict(),
  z.object({ action: z.literal('open'), id: componentIdSchema }).strict()
])

export function registerCreativeIpc(
  window: BrowserWindow,
  mamRoot: string,
  media: DesktopMediaDependencies
): () => void {
  ipcMain.handle(MAM_CREATIVE_CHANNEL, async (event, input: unknown) => {
    assertTrustedRenderer(event, window)
    const request = requestSchema.parse(input)
    const { registry, host } = await desktopCreativeServices(
      mamRoot,
      creativeFactory(mamRoot, media)
    )
    if (request.action === 'install') {
      const selected = await dialog.showOpenDialog(window, {
        title: '导入创作组件 / Import creative component',
        properties: ['openDirectory']
      })
      const sourceDirectory = selected.filePaths[0]
      if (!selected.canceled && sourceDirectory) {
        const confirm = await dialog.showMessageBox(window, {
          type: 'question',
          title: '导入本地组件 / Import local component',
          message:
            '只导入你信任的组件包。此入口验证文件完整性，但不验证发布者签名。\nImport a package you trust. File integrity is checked; publisher signatures are not verified by local import.',
          buttons: ['取消 / Cancel', '导入 / Import'],
          defaultId: 0,
          cancelId: 0
        })
        if (confirm.response === 1) await registry.install({ sourceDirectory, trustLocal: true })
      }
    } else if (request.action === 'enable')
      await registry.enable({ id: request.id, version: request.version })
    else if (request.action === 'disable') await registry.disable({ id: request.id })
    else if (request.action === 'remove')
      await registry.remove({ id: request.id, version: request.version })
    else if (request.action === 'open') return host.open(request.id)
    return registry.list()
  })
  return () => ipcMain.removeHandler(MAM_CREATIVE_CHANNEL)
}
