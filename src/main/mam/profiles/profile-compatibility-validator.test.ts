import { describe, expect, it } from 'vitest'
import type {
  ExecutorCapabilities,
  ExecutorProfile,
  ModelProfile,
  ProviderProfile
} from '../../../shared/mam/domain/execution-profile'
import type { RoleProfile } from '../../../shared/mam/domain/role'
import { validateProfileCompatibility } from './profile-compatibility-validator'

describe('Profile compatibility validation', () => {
  it('returns specific capability errors without selecting a fallback', () => {
    const result = validateProfileCompatibility({
      ...compatibleInput(),
      capabilities: {
        ...fullCapabilities(),
        supportedProtocols: [],
        supportsCustomEndpoint: false,
        supportsModelOverride: false,
        supportsPerInstanceConfig: false,
        supportsPerInstanceCredentials: false,
        supportsSkills: false,
        supportedMcpTransports: [],
        supportsKnowledgeGateway: false,
        supportsStructuredOutput: false
      }
    })
    expect(result.ok).toBe(false)
    expect(result.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        'protocol_unsupported',
        'custom_endpoint_unsupported',
        'model_override_unsupported',
        'per_instance_config_unsupported',
        'per_instance_credentials_unsupported',
        'structured_output_unsupported',
        'skills_unsupported',
        'mcp_transport_unsupported',
        'knowledge_gateway_unsupported'
      ])
    )
  })

  it('reports unavailable secrets and required Knowledge Bases independently', () => {
    const input = compatibleInput()
    const result = validateProfileCompatibility({
      ...input,
      resources: {
        ...input.resources,
        knowledgeBases: input.resources.knowledgeBases.map((entry) => ({
          ...entry,
          status: 'degraded' as const
        }))
      },
      availableSecretRefs: new Set()
    })
    expect(result.ok).toBe(false)
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'secret_unavailable', resourceId: 'secret.provider' }),
        expect.objectContaining({ code: 'secret_unavailable', resourceId: 'secret.mcp' }),
        expect.objectContaining({
          code: 'required_knowledge_unavailable',
          resourceId: 'knowledge.required'
        })
      ])
    )
  })

  it('rejects a Skill that does not support the selected Executor', () => {
    const input = compatibleInput()
    const result = validateProfileCompatibility({
      ...input,
      resources: {
        ...input.resources,
        skills: input.resources.skills.map((skill) => ({
          ...skill,
          supportedExecutors: ['pi-rpc' as const]
        }))
      }
    })
    expect(result).toMatchObject({
      ok: false,
      issues: [expect.objectContaining({ code: 'skill_executor_unsupported' })]
    })
  })
})

function compatibleInput() {
  const role = roleProfile()
  return {
    role,
    executor: executorProfile(),
    provider: providerProfile(),
    model: modelProfile(),
    capabilities: fullCapabilities(),
    resources: {
      skills: [
        {
          schemaVersion: '1.0.0' as const,
          id: 'skill.allowed',
          version: 1,
          name: 'Allowed Skill',
          description: 'Allowed.',
          supportedExecutors: ['codex-cli' as const],
          contentDigest: 'a'.repeat(64),
          enabled: true,
          importedAt: '2026-07-28T01:00:00Z'
        }
      ],
      mcpServers: [
        {
          id: 'mcp.allowed',
          version: 1,
          displayName: 'Allowed MCP',
          transport: 'stdio' as const,
          connectionRef: 'connection.mcp',
          credentialRef: 'secret.mcp'
        }
      ],
      knowledgeBases: [
        {
          profile: {
            id: 'knowledge.required',
            version: 1,
            displayName: 'Required Knowledge',
            kind: 'project-files' as const,
            sourceRef: 'repository.root'
          },
          status: 'available' as const
        }
      ]
    },
    availableSecretRefs: new Set(['secret.provider', 'secret.mcp'])
  }
}

function executorProfile(): ExecutorProfile {
  return {
    id: 'executor.codex',
    version: 1,
    kind: 'codex-cli',
    executableRef: 'executable.codex',
    adapterOptions: {}
  }
}

function providerProfile(): ProviderProfile {
  return {
    id: 'provider.compatible',
    version: 1,
    protocol: 'openai-responses',
    baseUrl: 'https://models.example.test/v1',
    secretRef: 'secret.provider'
  }
}

function modelProfile(): ModelProfile {
  return {
    id: 'model.compatible',
    version: 1,
    displayName: 'Compatible Model',
    providerProfileId: 'provider.compatible',
    remoteModelId: 'model-id',
    capabilities: {
      modalities: ['text'],
      supportsTools: true,
      supportsStructuredOutput: true
    }
  }
}

function roleProfile(): RoleProfile {
  return {
    schemaVersion: '1.0.0',
    id: 'role.arbitrary-name',
    version: 1,
    displayName: 'Arbitrary Role',
    execution: {
      executorProfileId: 'executor.codex',
      modelProfileId: 'model.compatible'
    },
    systemPromptRef: 'prompt.role',
    skillBindings: [{ skillId: 'skill.allowed' }],
    mcpBindings: [{ serverProfileId: 'mcp.allowed' }],
    knowledgeBaseBindings: [{ knowledgeBaseProfileId: 'knowledge.required' }],
    tools: [],
    permissions: {
      readPaths: ['.'],
      writePaths: [],
      allowedCommands: [],
      deniedCommands: [],
      allowedNetworkHosts: [],
      requireApprovalFor: []
    },
    budget: {
      maxInputTokens: 10_000,
      maxOutputTokens: 2_000,
      maxCostUsd: 1,
      maxDurationSeconds: 600
    },
    retry: { maxAttempts: 1, initialBackoffMs: 0, maxBackoffMs: 0 },
    contextPolicy: {
      maxContextTokens: 10_000,
      compaction: 'disabled',
      includePreviousAttempts: false
    }
  }
}

function fullCapabilities(): ExecutorCapabilities {
  return {
    supportedProtocols: ['openai-responses'],
    supportsCustomEndpoint: true,
    supportsModelOverride: true,
    supportsPerInstanceConfig: true,
    supportsPerInstanceCredentials: true,
    supportsSkills: true,
    supportedMcpTransports: ['stdio'],
    supportsKnowledgeGateway: true,
    supportsStructuredOutput: true,
    supportsInvocationReconnect: false
  }
}
