import { contextBridge, ipcRenderer } from 'electron'
import { MAM_CREATIVE_CHANNEL, type CreativeRendererApi } from '../shared/mam/creative-api'

export function exposeCreativeApi(): void {
  const api: CreativeRendererApi = {
    list: () => ipcRenderer.invoke(MAM_CREATIVE_CHANNEL, { action: 'list' }),
    install: () => ipcRenderer.invoke(MAM_CREATIVE_CHANNEL, { action: 'install' }),
    enable: (id, version) =>
      ipcRenderer.invoke(MAM_CREATIVE_CHANNEL, { action: 'enable', id, version }),
    disable: (id) => ipcRenderer.invoke(MAM_CREATIVE_CHANNEL, { action: 'disable', id }),
    remove: (id, version) =>
      ipcRenderer.invoke(MAM_CREATIVE_CHANNEL, { action: 'remove', id, version }),
    open: (id) => ipcRenderer.invoke(MAM_CREATIVE_CHANNEL, { action: 'open', id })
  }
  contextBridge.exposeInMainWorld('mamCreative', api)
}
