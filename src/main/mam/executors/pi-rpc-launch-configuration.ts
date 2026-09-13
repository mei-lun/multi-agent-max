import type { EffectiveRoleConfigSnapshot } from '../../../shared/mam/domain/role'
import type { ProviderProtocol } from '../../../shared/mam/domain/execution-profile'

export function piModels(snapshot: EffectiveRoleConfigSnapshot): Record<string, unknown> {
  const secretEnvironmentKey = snapshot.execution.providerSecretRef
    ? 'MAM_PI_PROVIDER_KEY'
    : undefined
  return {
    providers: {
      [snapshot.providerProfile.id]: {
        api: snapshot.execution.providerProtocol,
        // Identify the host app: some compatible gateways reject the SDK's default User-Agent.
        ...(['openai-responses', 'openai-completions'].includes(snapshot.execution.providerProtocol)
          ? { headers: { 'User-Agent': 'Multi-Agent-Max' } }
          : {}),
        ...(snapshot.execution.providerBaseUrl
          ? {
              baseUrl: piProviderBaseUrl(
                snapshot.execution.providerProtocol,
                snapshot.execution.providerBaseUrl
              )
            }
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

export function piProviderBaseUrl(protocol: ProviderProtocol, configured: string): string {
  if (protocol !== 'openai-responses' && protocol !== 'openai-completions') return configured
  const base = new URL(configured)
  const suffix = protocol === 'openai-responses' ? '/responses' : '/chat/completions'
  const path = base.pathname.replace(/\/+$/, '')
  // Pi's SDK appends the operation path; bare origins use the same /v1 default as Design.
  base.pathname = path.endsWith(suffix) ? path.slice(0, -suffix.length) || '/' : path || '/v1'
  return base.toString().replace(/\/$/, '')
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
    'mam_ask_user',
    'mam_confirm_understanding',
    ...(snapshot.mcpBindings.length ? ['mam_mcp'] : []),
    ...(snapshot.knowledgeBaseBindings.length ? ['mam_knowledge_search', 'mam_knowledge_read'] : [])
  ]
}
