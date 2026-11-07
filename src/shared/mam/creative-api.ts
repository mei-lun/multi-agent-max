import type { ComponentId, ComponentManifest } from './components'

export const MAM_CREATIVE_CHANNEL = 'mam:creative-components'
export type CreativeComponentVersion = Readonly<{
  manifest: ComponentManifest
  verification: string
  enabled: boolean
  status: string
  missingResources: string[]
}>
export type CreativeComponent = Readonly<{
  id: ComponentId
  distribution: string
  available: boolean
  versions: CreativeComponentVersion[]
}>
export type CreativeRendererApi = Readonly<{
  list(): Promise<CreativeComponent[]>
  install(): Promise<CreativeComponent[]>
  enable(id: ComponentId, version: string): Promise<CreativeComponent[]>
  disable(id: ComponentId): Promise<CreativeComponent[]>
  remove(id: ComponentId, version: string): Promise<CreativeComponent[]>
  open(id: ComponentId): Promise<void>
}>
