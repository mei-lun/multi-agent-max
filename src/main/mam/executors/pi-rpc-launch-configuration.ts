import type { EffectiveRoleConfigSnapshot } from '../../../shared/mam/domain/role'

export function piModels(snapshot: EffectiveRoleConfigSnapshot): Record<string, unknown> {
  const secretEnvironmentKey = snapshot.execution.providerSecretRef
    ? 'MAM_PI_PROVIDER_KEY'
    : undefined
  return {
    providers: {
      [snapshot.providerProfile.id]: {
        api: snapshot.execution.providerProtocol,
        ...(snapshot.execution.providerBaseUrl
          ? { baseUrl: snapshot.execution.providerBaseUrl }
          : {}),
        ...(secretEnvironmentKey ? { apiKey: `$${secretEnvironmentKey}` } : {}),
        models: [
          {
            id: snapshot.execution.remoteModelId,
            name: snapshot.execution.remoteModelId,
            contextWindow: snapshot.contextPolicy.maxContextTokens,
            maxTokens: snapshot.budget.maxOutputTokens
          }
        ]
      }
    }
  }
}

export function piArguments(
  snapshot: EffectiveRoleConfigSnapshot,
  systemPrompt: string,
  sessionDirectory: string,
  skillPaths: readonly string[],
  applicationApiExtensionPath: string | undefined,
  bridgeTools: readonly string[]
): string[] {
  const args = [
    '--no-extensions',
    '--no-skills',
    '--no-prompt-templates',
    '--no-themes',
    '--no-context-files',
    '--no-approve',
    '--session-dir',
    sessionDirectory,
    '--system-prompt',
    systemPrompt
  ]
  for (const skillPath of skillPaths) args.push('--skill', skillPath)
  if (applicationApiExtensionPath) args.push('--extension', applicationApiExtensionPath)
  const resourceTools = new Set(['mcp.execute', 'knowledge.search', 'knowledge.read'])
  const tools = [
    ...workspaceTools(snapshot),
    ...snapshot.tools
      .filter((tool) => !tool.startsWith('mcp.') && !resourceTools.has(tool))
      .map((tool) => (tool === 'shell' ? 'bash' : tool)),
    ...bridgeTools
  ]
  if (tools.length > 0) args.push('--tools', [...new Set(tools)].join(','))
  else args.push('--no-tools')
  const thinkingLevel = snapshot.execution.inference.thinkingLevel
  if (typeof thinkingLevel === 'string') args.push('--thinking', thinkingLevel)
  return args
}

function workspaceTools(snapshot: EffectiveRoleConfigSnapshot): string[] {
  if (snapshot.permissions.writePaths.length > 0) {
    return ['read', 'bash', 'edit', 'write', 'grep', 'find', 'ls']
  }
  if (snapshot.permissions.readPaths.length > 0) return ['read', 'grep', 'find', 'ls']
  return []
}

export function piBridgeTools(snapshot: EffectiveRoleConfigSnapshot): string[] {
  return [
    ...(snapshot.mcpBindings.length ? ['mam_mcp'] : []),
    ...(snapshot.knowledgeBaseBindings.length ? ['mam_knowledge_search', 'mam_knowledge_read'] : [])
  ]
}
