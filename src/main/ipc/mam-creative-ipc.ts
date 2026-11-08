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
import { join } from 'node:path'
import { CreativeDraftStore } from '../mam/components/creative-drafts'
import { creativeProjectScope } from '../mam/components/creative-project-scope'
import { creativeDeliverySelection } from '../../shared/mam/creative-delivery'
import {
  CreativeDeliveryStore,
  type CreativeDeliveryProject
} from '../mam/artifacts/creative-delivery'
import { creativeDeliveryDialog } from './creative-delivery-dialogs'

const requestSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('listDraftJobs') }).strict(),
  z.object({ action: z.literal('listDrafts') }).strict(),
  z.object({ action: z.literal('createDraft'), jobId: z.uuid() }).strict(),
  z.object({ action: z.literal('list') }).strict(),
  z.object({ action: z.literal('install') }).strict(),
  z.object({ action: z.literal('listDeliveries') }).strict(),
  z.object({ action: z.literal('exportDelivery'), selection: creativeDeliverySelection }).strict(),
  z.object({ action: z.literal('importDelivery'), selection: creativeDeliverySelection }).strict(),
  z.object({ action: z.literal('enable'), id: componentIdSchema, version: versionSchema }).strict(),
  z.object({ action: z.literal('disable'), id: componentIdSchema }).strict(),
  z.object({ action: z.literal('remove'), id: componentIdSchema, version: versionSchema }).strict(),
  z
    .object({
      action: z.literal('open'),
      id: componentIdSchema,
      scope: z.enum(['project', 'local']).default('project')
    })
    .strict()
])

export function registerCreativeIpc(
  window: BrowserWindow,
  mamRoot: string,
  media: DesktopMediaDependencies,
  projectDirectory: () => string | undefined = () => undefined,
  deliveryProject: () => CreativeDeliveryProject | undefined = () => undefined
): () => void {
  ipcMain.handle(MAM_CREATIVE_CHANNEL, async (event, input: unknown) => {
    assertTrustedRenderer(event, window)
    const request = requestSchema.parse(input)
    if (
      request.action === 'listDeliveries' ||
      request.action === 'exportDelivery' ||
      request.action === 'importDelivery'
    ) {
      const project = deliveryProject()
      if (!project) {
        if (request.action === 'listDeliveries') return []
        throw new Error('Connect a Git project to transfer submitted artifacts')
      }
      if (request.action === 'listDeliveries')
        return new CreativeDeliveryStore(mamRoot, project).list()
      return creativeDeliveryDialog(window, mamRoot, project, request.action, request.selection)
    }
    const { registry, host, jobs, assets } = await desktopCreativeServices(
      mamRoot,
      creativeFactory(mamRoot, media)
    )
    if (
      request.action === 'listDraftJobs' ||
      request.action === 'listDrafts' ||
      request.action === 'createDraft'
    ) {
      const directory = projectDirectory()
      if (!directory) {
        if (request.action !== 'createDraft') return []
        throw new Error('Connect a Git project to prepare delivery drafts')
      }
      const projectId = creativeProjectScope(directory)
      const drafts = new CreativeDraftStore(join(mamRoot, 'creative-drafts'), assets)
      if (request.action === 'listDrafts') return drafts.list(projectId)
      if (request.action === 'createDraft') return drafts.create(projectId, jobs.get(request.jobId))
      return jobs
        .list()
        .filter(
          (job) =>
            job.request.projectId === projectId && !job.request.attempt && job.state === 'succeeded'
        )
        .map((job) => ({
          id: job.id,
          componentId: job.request.componentId,
          operation: job.request.operation,
          assetCount: job.events.filter((event) => event.type === 'asset').length,
          textPreview: JSON.stringify(job.events.at(-1)?.data ?? '').slice(0, 240)
        }))
    }
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
    else if (request.action === 'open') {
      const directory = request.scope === 'project' ? projectDirectory() : undefined
      const projectId = directory ? creativeProjectScope(directory) : 'creative.local'
      return host.open(request.id, projectId)
    }
    return registry.list()
  })
  return () => ipcMain.removeHandler(MAM_CREATIVE_CHANNEL)
}
