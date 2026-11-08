import type { BrowserWindow } from 'electron'
import type { ComponentManifest } from '../../../shared/mam/components'
import type { AssetRef } from '../../../shared/mam/creative-runtime'
import type { BinaryAssetStore, CreativeJobManager, HandlerRegistry } from '../creative-runtime'
import type { ComponentRegistry } from './registry'
import type { RifeSettings } from './host-rife-settings'
import type { AssetGrants } from './host-asset-grants'
import type { ConstellationToolSessions } from './host-constellation-tools'

export type ComponentHostContext = { projectId: string; manifest: ComponentManifest }
export type ComponentBinding = { window: BrowserWindow; context: ComponentHostContext }
export type ComponentHostOptions = {
  registry: ComponentRegistry
  jobs: CreativeJobManager
  assets: BinaryAssetStore
  handlers: HandlerRegistry
  projectId: string
  preloadPath: string
  authorizationDirectory: string
  protectedDirectories?: readonly string[]
  listModels?: () => unknown | Promise<unknown>
  rifeSettings?: RifeSettings
}
export type ComponentDispatchContext = {
  options: ComponentHostOptions
  grants: AssetGrants
  tools: ConstellationToolSessions
  previews: Map<string, { sender: number; ref: AssetRef }>
  pin(id: string): Promise<void>
  open(id: ComponentManifest['id'], projectId: string): Promise<void>
}
