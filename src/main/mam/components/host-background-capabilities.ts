import { dialog } from 'electron'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { CreativeRequest } from '../../../shared/mam/creative-runtime'
import { componentHostRequestSchema } from '../../../shared/mam/component-host-api'
import { componentIdSchema } from '../../../shared/mam/components'
import { constellationCall } from '../../../shared/mam/constellation-tools'
import type { OperationHandler } from '../creative-runtime'
import type { ComponentDispatchContext } from './component-host-context'
import { createConstellationTools } from './constellation-tools'
import { runConversation } from './host-conversations'

export function createBackgroundCapabilities(context: ComponentDispatchContext) {
  const tools = createConstellationTools({
    root: context.options.protectedDirectories?.[0] ?? context.options.authorizationDirectory,
    assets: context.options.assets,
    chooseWorkspace: async () => {
      const result = await dialog.showOpenDialog({
        title: '选择星图工具工作目录 / Choose tool workspace',
        properties: ['openDirectory']
      })
      return result.canceled ? undefined : result.filePaths[0]
    },
    requestApproval: async ({ call, workspace }) => {
      const result = await dialog.showMessageBox({
        type: 'question',
        title: '星图后台命令 / Background graph command',
        message: call.name === 'run_command' ? call.args.command : call.name,
        detail: `工作目录 / Workspace: ${workspace ?? ''}`,
        buttons: ['取消 / Cancel', '执行 / Run'],
        defaultId: 0,
        cancelId: 0
      })
      return result.response === 1
    }
  })
  return async (
    request: CreativeRequest,
    method: string,
    value: unknown,
    execution: Parameters<OperationHandler['run']>[1]
  ) => {
    execution.signal.throwIfAborted()
    const graph =
      request.componentId === 'creative.constellation' &&
      request.operation === 'constellation.graph.execute'
    const writing =
      request.componentId === 'creative.writing' &&
      /^writing\.goal\.(plan|execute)$/.test(request.operation)
    if (request.attempt || (!graph && !(writing && method === 'operation.authorize')))
      throw new Error('Background capability is outside the manual graph authority')
    const job = context.options.jobs
      .list()
      .find(
        (job) =>
          job.request.componentId === request.componentId &&
          job.request.projectId === request.projectId &&
          job.request.idempotencyKey === request.idempotencyKey
      )
    if (!job || job.state !== 'running') throw new Error('Background graph is not running')
    const lease = await context.options.registry.acquireVersion(
      componentIdSchema.parse(request.componentId),
      request.componentVersion
    )
    try {
      if (method === 'graph.authorize' || method === 'operation.authorize') {
        const nested = z
          .object({
            operation: z.string(),
            params: z.record(z.string(), z.unknown()),
            inputAssets: z.array(z.unknown())
          })
          .strict()
          .parse(value)
        if (
          !/^(image|video|speech|text|vision)\./.test(nested.operation) ||
          !lease.manifest.operations.some((item) => item.id === nested.operation)
        )
          throw new Error('Nested operation is absent from the component manifest')
        if (
          writing &&
          (nested.operation !== 'text.generate' ||
            nested.params.modelProfileId !== request.params.modelProfileId)
        )
          throw new Error('Writing model changed during execution')
        return { authorized: true }
      }
      if (method === 'graph.tool') {
        if (
          !lease.manifest.operations.some(
            (op) => op.id === 'tool.execute' && op.requiredCapabilities.includes('tools.manual')
          )
        )
          throw new Error('Graph tool capability unavailable')
        const call = constellationCall.parse(value)
        const authority = {
          componentId: request.componentId,
          projectId: request.projectId,
          windowId: 0
        }
        const approval = await tools.check(call, authority)
        execution.signal.throwIfAborted()
        await execution.emit('log', {
          type: 'graph_tool_authorization',
          name: call.name,
          decision: approval.decision
        })
        if (approval.decision !== 'allow' || !approval.token)
          throw new Error('Graph tool authorization denied')
        const result = await tools.execute(approval.token, authority, execution.signal)
        execution.signal.throwIfAborted()
        if (result.isError) throw new Error(result.output)
        return result.output
      }
      if (method === 'graph.conversation') {
        const input = componentHostRequestSchema.parse({
          ...(value as object),
          action: 'runConversation',
          invocationId: randomUUID()
        })
        if (input.action !== 'runConversation') throw new Error('Invalid conversation request')
        const result = await runConversation(
          context,
          { projectId: request.projectId, manifest: lease.manifest },
          input,
          execution.signal
        )
        execution.signal.throwIfAborted()
        return result
      }
      throw new Error('Unknown background capability')
    } finally {
      lease.release()
    }
  }
}
