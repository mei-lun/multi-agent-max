import { createHash, randomUUID } from 'node:crypto'
import { appendFile, mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { dialog } from 'electron'
import { z } from 'zod'
import { constellationCall } from '../../../shared/mam/constellation-tools'
import { assetRefSchema } from '../../../shared/mam/creative-runtime'
import type { PreparedAttempt } from '../application/mam-attempt-execution-types'
import { assertComponentOperation } from '../application/component-operation-policy'
import type { HandlerRegistry } from '../creative-runtime'
import type { PackageRuntimeContext } from './package-runtime'
import {
  workspacePath,
  within,
  readWorkspaceFile,
  listWorkspace
} from './constellation-tools/workspace'
import { approvedCommand } from './constellation-tools/command'
import { fetchPublicText } from './constellation-tools/web'
import { assertComponentBudget } from './attempt-component-budget'
import { attemptComponentUsage } from './attempt-usage-budget'
import { acquireConversationTurn } from './attempt-conversation-store'

const conversationSchema = z
  .object({
    conversationId: z.uuid().optional(),
    modelProfileId: z.string(),
    command: z.string().min(1).max(100000),
    context: z.string().max(100000),
    inputAssets: z.array(assetRefSchema).max(100)
  })
  .strict()
export function createAttemptGraphCapabilities(options: {
  root: string
  workspace: string
  snapshot: PreparedAttempt['snapshot']
  authority: { attemptId: string; workflowRunId: string }
  handlers: HandlerRegistry
  approve?: (message: string, detail: string) => Promise<boolean>
}): NonNullable<PackageRuntimeContext['invokeCapability']> {
  const directory = join(
    options.root,
    'attempt-graph',
    createHash('sha256').update(options.authority.attemptId).digest('hex')
  )
  return async (request, method, value, execution) => {
    execution.signal.throwIfAborted()
    if (
      request.attempt?.id !== options.authority.attemptId ||
      request.projectId !== options.authority.workflowRunId ||
      !(
        (request.componentId === 'creative.constellation' &&
          request.operation === 'constellation.graph.execute') ||
        (method === 'operation.authorize' &&
          request.componentId === 'creative.writing' &&
          /^writing\.goal\.(plan|execute)$/.test(request.operation))
      )
    )
      throw new Error('Graph attempt authority mismatch')
    assertComponentOperation(options.snapshot, request.componentId, request.operation)
    const approve = async (category: string, operation: string, payload: unknown) => {
      const requestHash = createHash('sha256')
        .update(
          JSON.stringify({
            request,
            operation,
            payload,
            authority: options.authority,
            config: options.snapshot.contentHash
          })
        )
        .digest('hex')
      const required =
        category === 'command' ||
        options.snapshot.permissions.requireApprovalFor.includes(category as 'file' | 'network')
      const detail = `Attempt: ${options.authority.attemptId}\n${JSON.stringify(payload)}\nRequest: ${requestHash}`
      const allowed =
        !required ||
        (await (options.approve
          ? options.approve(operation, detail)
          : dialog
              .showMessageBox({
                type: 'question',
                title: 'Approve graph operation',
                message: operation,
                detail,
                buttons: ['Reject', 'Approve once'],
                defaultId: 0,
                cancelId: 0
              })
              .then((r) => r.response === 1)))
      await mkdir(directory, { recursive: true })
      await appendFile(
        join(directory, 'audit.jsonl'),
        JSON.stringify({
          requestHash,
          operation,
          category,
          allowed,
          authority: options.authority,
          at: new Date().toISOString()
        }) + '\n'
      )
      execution.signal.throwIfAborted()
      if (!allowed) throw new Error('Graph operation approval denied')
    }
    if (method === 'graph.tool') {
      assertComponentOperation(options.snapshot, request.componentId, 'tool.execute')
      const call = constellationCall.parse(value),
        policy = options.snapshot.permissions
      if (call.name === 'web_fetch') {
        const url = new URL(call.args.url)
        if (!policy.allowedNetworkHosts.some((host) => host === url.hostname))
          throw new Error('Graph network host denied')
        await approve('network', call.name, call.args)
        return fetchPublicText(url, execution.signal)
      }
      const path =
        call.name === 'run_command' ? (call.args.workdir ?? '.') : (call.args.path ?? '.')
      const target = await workspacePath(options.workspace, path)
      if (call.name === 'run_command') {
        const command = call.args.command
        const matches = (rule: string) =>
          rule === '*' || command === rule || command.startsWith(rule + ' ')
        if (
          /[;&|<>`$%(){}!^\r\n]/.test(command) ||
          policy.deniedCommands.some(matches) ||
          !policy.allowedCommands.some(matches)
        )
          throw new Error('Graph command denied')
        await approve('command', call.name, call.args)
        const result = await approvedCommand(
          command,
          target,
          options.snapshot.budget.maxDurationSeconds * 1000,
          execution.signal
        )
        if (result.isError) throw new Error(result.output)
        return result.output
      }
      const readable = await Promise.all(
        policy.readPaths.map((path) =>
          workspacePath(options.workspace, path).catch(() => undefined)
        )
      )
      if (!readable.some((path) => path && within(path, target)))
        throw new Error('Graph read path denied')
      await approve('file', call.name, call.args)
      return call.name === 'read_file'
        ? readWorkspaceFile(options.workspace, path, call.args.encoding)
        : listWorkspace(
            options.workspace,
            path,
            call.name === 'search_files' ? call.args.query : undefined
          )
    }
    if (method === 'graph.authorize' || method === 'operation.authorize') {
      const input = z
        .object({
          operation: z.string(),
          params: z.record(z.string(), z.unknown()),
          inputAssets: z.array(assetRefSchema)
        })
        .strict()
        .parse(value)
      if (!/^(image|video|speech|text|vision)\./.test(input.operation))
        throw new Error('Graph nested operation denied')
      assertComponentOperation(options.snapshot, request.componentId, input.operation)
      assertComponentBudget(options.snapshot, input.operation)
      await attemptComponentUsage(options.root, options.snapshot, input.operation)
      const binding = options.snapshot.componentBindings?.find(
        (item) => item.componentId === request.componentId
      )
      if (!binding?.model || input.params.modelProfileId !== binding.model.id)
        throw new Error('Frozen graph model required')
      await approve('network', input.operation, input)
      return { authorized: true }
    }
    if (method !== 'graph.conversation') throw new Error('Unknown attempt graph capability')
    const input = conversationSchema.parse(value)
    const operation = input.inputAssets.length ? 'vision.generate' : 'text.generate'
    assertComponentOperation(options.snapshot, request.componentId, operation)
    const binding = options.snapshot.componentBindings?.find(
      (item) => item.componentId === request.componentId
    )
    if (!binding?.model || input.modelProfileId !== binding.model.id)
      throw new Error('Frozen graph model required')
    assertComponentBudget(options.snapshot, operation)
    await attemptComponentUsage(options.root, options.snapshot, operation)
    const id = input.conversationId ?? randomUUID()
    const turn = await acquireConversationTurn(directory, id)
    try {
      execution.signal.throwIfAborted()
      const turns: string[] = input.conversationId
        ? JSON.parse(await readFile(turn.path, 'utf8'))
        : []
      const prompt = [input.context, ...turns, `user: ${input.command}`].join('\n\n')
      if (prompt.length > 1000000) throw new Error('Conversation context limit')
      await approve('network', operation, {
        conversationId: id,
        modelProfileId: input.modelProfileId,
        command: input.command
      })
      const nested = {
        ...request,
        operation,
        inputAssets: input.inputAssets,
        idempotencyKey: `${request.idempotencyKey}:conversation:${id}:${turns.length}`,
        params: { modelProfileId: binding.model.id, prompt }
      }
      const handler = options.handlers(nested)
      if (!handler) throw new Error('Graph text operation unavailable')
      handler.validate(nested)
      const result = (await handler.run(nested, execution)) as { text?: string }
      execution.signal.throwIfAborted()
      if (typeof result.text !== 'string') throw new Error('Conversation returned no text')
      await turn.save([...turns, `user: ${input.command}`, `assistant: ${result.text}`])
      await execution.emit('log', {
        type: 'attempt_graph_conversation',
        conversationId: id,
        attemptId: options.authority.attemptId,
        operation
      })
      return { conversationId: id, title: input.command.slice(0, 60), text: result.text }
    } finally {
      turn.release()
    }
  }
}
