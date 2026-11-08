import type { ComponentId, ComponentManifest } from './components'
import type { CreativeDelivery, CreativeDeliverySelection } from './creative-delivery'
import type { CreativeDraft, CreativeDraftJob } from './creative-draft'

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
  listDraftJobs(): Promise<CreativeDraftJob[]>
  createDraft(jobId: string): Promise<CreativeDraft>
  listDrafts(): Promise<CreativeDraft[]>
  install(): Promise<CreativeComponent[]>
  enable(id: ComponentId, version: string): Promise<CreativeComponent[]>
  disable(id: ComponentId): Promise<CreativeComponent[]>
  remove(id: ComponentId, version: string): Promise<CreativeComponent[]>
  open(id: ComponentId, scope?: 'project' | 'local'): Promise<void>
  listDeliveries(): Promise<CreativeDelivery[]>
  exportDelivery(selection: CreativeDeliverySelection): Promise<boolean>
  importDelivery(selection: CreativeDeliverySelection): Promise<boolean>
}>
