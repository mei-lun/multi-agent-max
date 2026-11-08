import { contextBridge, ipcRenderer } from 'electron'
import { MAM_CREATIVE_CHANNEL, type CreativeRendererApi } from '../shared/mam/creative-api'

export function exposeCreativeApi(): void {
  const api: CreativeRendererApi = {
    listDraftJobs: () => ipcRenderer.invoke(MAM_CREATIVE_CHANNEL, { action: 'listDraftJobs' }),
    createDraft: (jobId) =>
      ipcRenderer.invoke(MAM_CREATIVE_CHANNEL, { action: 'createDraft', jobId }),
    listDrafts: () => ipcRenderer.invoke(MAM_CREATIVE_CHANNEL, { action: 'listDrafts' }),
    list: () => ipcRenderer.invoke(MAM_CREATIVE_CHANNEL, { action: 'list' }),
    install: () => ipcRenderer.invoke(MAM_CREATIVE_CHANNEL, { action: 'install' }),
    enable: (id, version) =>
      ipcRenderer.invoke(MAM_CREATIVE_CHANNEL, { action: 'enable', id, version }),
    disable: (id) => ipcRenderer.invoke(MAM_CREATIVE_CHANNEL, { action: 'disable', id }),
    remove: (id, version) =>
      ipcRenderer.invoke(MAM_CREATIVE_CHANNEL, { action: 'remove', id, version }),
    open: (id, scope = 'project') =>
      ipcRenderer.invoke(MAM_CREATIVE_CHANNEL, { action: 'open', id, scope }),
    listDeliveries: () => ipcRenderer.invoke(MAM_CREATIVE_CHANNEL, { action: 'listDeliveries' }),
    exportDelivery: (selection) =>
      ipcRenderer.invoke(MAM_CREATIVE_CHANNEL, { action: 'exportDelivery', selection }),
    importDelivery: (selection) =>
      ipcRenderer.invoke(MAM_CREATIVE_CHANNEL, { action: 'importDelivery', selection })
  }
  contextBridge.exposeInMainWorld('mamCreative', api)
}
