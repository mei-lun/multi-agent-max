import { contextBridge, ipcRenderer } from 'electron'
import type { ComponentHostRequest } from '../shared/mam/component-host-api'
import {
  COMPONENT_HOST_CHANNEL,
  COMPONENT_CLOSE_REQUEST,
  COMPONENT_CLOSE_ACK
} from '../shared/mam/component-host-channel'
type BeforeClose = (event: { preventDefault(): void }) => void | boolean | Promise<void | boolean>
const callbacks = new Set<BeforeClose>()
ipcRenderer.on(COMPONENT_CLOSE_REQUEST, (_event, nonce: unknown) => {
  if (typeof nonce !== 'string') return
  void (async () => {
    let allow = true
    const pendingCallbacks = Array.from(callbacks)
    for (const callback of pendingCallbacks) {
      try {
        if (
          (await callback({
            preventDefault: () => {
              allow = false
            }
          })) === false
        )
          allow = false
      } catch {
        allow = false
      }
    }
    ipcRenderer.send(COMPONENT_CLOSE_ACK, { nonce, allow })
  })()
})
contextBridge.exposeInMainWorld('componentHost', {
  onBeforeClose: (callback: BeforeClose) => {
    if (typeof callback !== 'function') throw new Error('Close callback must be a function')
    callbacks.add(callback)
    return () => {
      callbacks.delete(callback)
    }
  },
  request: (input: ComponentHostRequest) => ipcRenderer.invoke(COMPONENT_HOST_CHANNEL, input)
})
