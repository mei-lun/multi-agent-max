import { realpath } from 'node:fs/promises'
import { resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { BinaryAssetStore } from '../../creative-runtime/assets'
import {
  constellationCall,
  type ConstellationCall,
  type ConstellationContext
} from '../../../../shared/mam/constellation-tools'
import { workspacePath, within, readWorkspaceFile, listWorkspace } from './workspace'
import { approvedCommand } from './command'
import { fetchPublicText } from './web'
type Ticket = {
  call: ConstellationCall
  context: ConstellationContext
  workspace?: string
  expires: number
}
export function createConstellationTools(options: {
  root: string
  assets: BinaryAssetStore
  requestApproval: (details: { call: ConstellationCall; workspace?: string }) => Promise<boolean>
  chooseWorkspace: () => Promise<string | undefined>
  fetch?: typeof fetch
}) {
  const tickets = new Map<string, Ticket>(),
    workspaces = new Map<string, string>()
  const key = (context: ConstellationContext) => JSON.stringify(context)
  const trusted = (context: ConstellationContext) =>
    context.componentId === 'creative.constellation' &&
    !!context.projectId &&
    Number.isSafeInteger(context.windowId)
  return {
    async check(
      input: unknown,
      context: ConstellationContext
    ): Promise<{ decision: 'allow' | 'deny'; token?: string }> {
      if (!trusted(context)) return { decision: 'deny' }
      try {
        const parsed = constellationCall.safeParse(input)
        if (!parsed.success) return { decision: 'deny' }
        const call = structuredClone(parsed.data),
          binding = structuredClone(context)
        let workspace = workspaces.get(key(binding))
        if (call.name !== 'web_fetch') {
          if (!workspace) {
            const selection = await options.chooseWorkspace()
            if (!selection) return { decision: 'deny' }
            workspace = await realpath(selection)
            const managed = await realpath(options.root).catch(() => resolve(options.root))
            if (within(managed, workspace) || within(workspace, managed))
              return { decision: 'deny' }
            workspaces.set(key(binding), workspace)
          }
          await workspacePath(
            workspace,
            call.name === 'run_command' ? (call.args.workdir ?? '.') : (call.args.path ?? '.')
          )
        }
        if (call.name === 'web_fetch') {
          const url = new URL(call.args.url)
          if (url.protocol !== 'https:' || url.username || url.password) return { decision: 'deny' }
        }
        if (
          call.name === 'run_command' &&
          !(await options.requestApproval({
            call: structuredClone(call),
            ...(workspace ? { workspace } : {})
          }))
        )
          return { decision: 'deny' }
        const token = randomUUID()
        tickets.set(token, {
          call,
          context: binding,
          ...(workspace ? { workspace } : {}),
          expires: Date.now() + 60000
        })
        return { decision: 'allow', token }
      } catch {
        return { decision: 'deny' }
      }
    },
    async execute(
      token: string,
      context: ConstellationContext
    ): Promise<{ output: string; isError: boolean }> {
      const ticket = tickets.get(token)
      if (
        !ticket ||
        !trusted(context) ||
        key(context) !== key(ticket.context) ||
        Date.now() > ticket.expires
      )
        return { output: 'Tool authorization invalid or expired', isError: true }
      tickets.delete(token)
      try {
        const { call, workspace } = ticket
        if (call.name === 'run_command')
          return approvedCommand(
            call.args.command,
            await workspacePath(workspace!, call.args.workdir ?? '.')
          )
        if (call.name === 'read_file')
          return {
            output: await readWorkspaceFile(workspace!, call.args.path, call.args.encoding),
            isError: false
          }
        if (call.name === 'list_files' || call.name === 'search_files')
          return {
            output: await listWorkspace(
              workspace!,
              call.args.path ?? '.',
              call.name === 'search_files' ? call.args.query : undefined
            ),
            isError: false
          }
        const text = await fetchPublicText(new URL(call.args.url))
        return {
          output: text
            .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
            .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
            .replace(/<[^>]+>/g, ' ')
            .slice(0, 120000),
          isError: false
        }
      } catch {
        return { output: 'Local tool failed or exceeded its bounds', isError: true }
      }
    }
  }
}
