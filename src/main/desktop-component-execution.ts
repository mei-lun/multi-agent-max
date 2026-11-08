import { createComponentExecutionPort } from './mam/components/attempt-component-executor'
import { dialog } from 'electron'
import { appendFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { createComponentTools } from './mam/components/attempt-component-tools'
import { desktopCreativeServices } from './mam/components/desktop-creative-services'
import {
  creativeFactory,
  type DesktopMediaDependencies
} from './mam/components/desktop-creative-factory'

export function desktopComponentExecution(root: string, media: DesktopMediaDependencies) {
  const options = {
    root,
    requestApproval: async ({
      request,
      requestHash,
      categories
    }: {
      request: unknown
      requestHash: string
      categories: string[]
    }) => {
      const details = request as {
        component: { id: string; operation: string; version: string }
        identity: { manifestHash: string }
      }
      const decision = await dialog.showMessageBox({
        type: 'question',
        title: 'Approve component task',
        message: `${details.component.id}: ${details.component.operation}`,
        detail: `Version: ${details.component.version}\nManifest: ${details.identity.manifestHash}\nPermissions: ${categories.join(', ')}\nProvider cost may be charged.\nRequest: ${requestHash}`,
        buttons: ['Reject', 'Approve this operation'],
        defaultId: 0,
        cancelId: 0
      })
      return decision.response === 1
    },
    audit: async (receipt: Record<string, unknown>) => {
      const directory = join(root, 'component-approval-audit')
      await mkdir(directory, { recursive: true })
      await appendFile(
        join(directory, 'receipts.jsonl'),
        JSON.stringify({ ...receipt, recordedAt: new Date().toISOString() }) + '\n'
      )
    },
    services: () => desktopCreativeServices(root, creativeFactory(root, media))
  }
  return {
    componentExecutor: createComponentExecutionPort(options),
    componentTools: createComponentTools(options)
  }
}
