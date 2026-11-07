import { contextBridge, ipcRenderer } from 'electron'
import type { ComponentHostRequest } from '../shared/mam/component-host-api'
import { COMPONENT_HOST_CHANNEL } from '../shared/mam/component-host-channel'
contextBridge.exposeInMainWorld('componentHost', {
  request: (input: ComponentHostRequest) => ipcRenderer.invoke(COMPONENT_HOST_CHANNEL, input)
})
