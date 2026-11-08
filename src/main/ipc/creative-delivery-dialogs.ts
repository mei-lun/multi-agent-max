import { dialog, type BrowserWindow } from 'electron'
import { join, relative, isAbsolute, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { CreativeDeliverySelection } from '../../shared/mam/creative-delivery'
import {
  CreativeDeliveryStore,
  type CreativeDeliveryProject
} from '../mam/artifacts/creative-delivery'

export async function creativeDeliveryDialog(
  window: BrowserWindow,
  root: string,
  project: CreativeDeliveryProject,
  action: 'exportDelivery' | 'importDelivery',
  selection: CreativeDeliverySelection
) {
  const result = await dialog.showOpenDialog(window, {
    title:
      action === 'exportDelivery'
        ? '选择交付包保存目录 / Export delivery'
        : '选择交付包目录 / Import delivery',
    properties: ['openDirectory']
  })
  const directory = result.filePaths[0]
  if (result.canceled || !directory) return false
  const store = new CreativeDeliveryStore(root, project)
  if (action === 'importDelivery') await store.import(selection, directory)
  else {
    const protectedRoot = relative(resolve(root), resolve(directory))
    if (
      !protectedRoot ||
      (!isAbsolute(protectedRoot) &&
        protectedRoot !== '..' &&
        !protectedRoot.startsWith('..\\') &&
        !protectedRoot.startsWith('../'))
    )
      throw new Error('Choose a directory outside application data')
    await store.export(selection, join(directory, `mam-delivery-${randomUUID()}`))
  }
  return true
}
