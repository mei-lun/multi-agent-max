import type { MamSaveProfileInput } from '../../../../shared/mam/application-command'
import type { MamUiSnapshot } from '../../../../shared/mam/ui-projection'

type ProfileKind = MamSaveProfileInput['kind']

export function mamProfileTemplate(
  kind: ProfileKind,
  snapshot: MamUiSnapshot
): MamSaveProfileInput['profile'] {
  if (kind === 'role') {
    return {
      schemaVersion: '1.0.0',
      id: 'role.new',
      version: 1,
      displayName: 'New role',
      execution: {
        executorProfileId: snapshot.executors[0]?.id ?? 'executor.default',
        modelProfileId: snapshot.models[0]?.id ?? 'model.default'
      },
      systemPromptRef:
        'inline:Follow the assigned Task specification and report structured evidence.',
      skillBindings: [],
      mcpBindings: [],
      knowledgeBaseBindings: [],
      tools: [],
      permissions: {
        readPaths: ['.'],
        writePaths: [],
        allowedCommands: [],
        deniedCommands: [],
        allowedNetworkHosts: [],
        requireApprovalFor: ['file', 'command', 'network', 'mcp', 'knowledge']
      },
      budget: {
        maxInputTokens: 100_000,
        maxOutputTokens: 20_000,
        maxCostUsd: 10,
        maxDurationSeconds: 3600
      },
      retry: { maxAttempts: 3, initialBackoffMs: 1000, maxBackoffMs: 30_000 },
      contextPolicy: {
        maxContextTokens: 100_000,
        compaction: 'scheduler',
        includePreviousAttempts: true
      }
    }
  }
  if (kind === 'executor') {
    return {
      id: 'executor.pi',
      version: 1,
      kind: 'pi-rpc',
      executableRef: 'pi',
      adapterOptions: { mode: 'rpc' }
    }
  }
  if (kind === 'provider') {
    return {
      id: 'provider.pi',
      version: 1,
      protocol: 'openai-completions',
      secretRef: 'secret.pi'
    }
  }
  if (kind === 'model') {
    return {
      id: 'model.default',
      version: 1,
      displayName: 'Default model',
      providerProfileId: snapshot.providers[0]?.id ?? 'provider.pi',
      remoteModelId: 'model-id',
      capabilities: {
        modalities: ['text'],
        supportsTools: true,
        supportsStructuredOutput: true
      },
      defaultInference: {}
    }
  }
  if (kind === 'mcp') {
    return {
      id: 'mcp.new',
      version: 1,
      displayName: 'New MCP server',
      transport: 'stdio',
      connectionRef: 'mcp.connection.new'
    }
  }
  if (kind === 'knowledge') {
    return {
      id: 'knowledge.project',
      version: 1,
      displayName: 'Project files',
      kind: 'project-files',
      sourceRef: '.'
    }
  }
  return {
    schemaVersion: '1.0.0',
    id: 'skill.imported',
    version: 1,
    name: 'Imported Skill',
    description: '',
    supportedExecutors: ['pi-rpc'],
    contentDigest: '0'.repeat(64),
    enabled: true,
    importedAt: new Date(0).toISOString()
  }
}
