import type { BrowserWindow } from 'electron'
import { MAM_UI_SNAPSHOT_CHANGED_CHANNEL } from '../shared/mam/application-api'

export function createSnapshotChangeNotifier(window: BrowserWindow): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined
  return () => {
    if (timer || window.isDestroyed()) return
    timer = setTimeout(() => {
      timer = undefined
      if (!window.isDestroyed()) window.webContents.send(MAM_UI_SNAPSHOT_CHANGED_CHANNEL)
    }, 120)
  }
}
