import {
  ExecutorCapabilitiesSchema,
  type ExecutorCapabilities,
  type ExecutorProfile,
  type ModelProfile,
  type ProviderProfile
} from '../../../shared/mam/domain/execution-profile'
import type {
  KnowledgeBaseProfile,
  McpServerProfile
} from '../../../shared/mam/domain/resource-profile'
import type { RoleProfile } from '../../../shared/mam/domain/role'
import type { MamSkillDefinition } from '../../../shared/mam/domain/skill-definition'

export type ProfileCompatibilityIssue = Readonly<{
  code:
    | 'protocol_unsupported'
    | 'custom_endpoint_unsupported'
    | 'model_override_unsupported'
    | 'per_instance_config_unsupported'
    | 'per_instance_credentials_unsupported'
    | 'structured_output_unsupported'
    | 'model_structured_output_unsupported'
    | 'skills_unsupported'
    | 'skill_executor_unsupported'
    | 'mcp_transport_unsupported'
    | 'knowledge_gateway_unsupported'
    | 'secret_unavailable'
    | 'required_knowledge_unavailable'
    | 'duplicate_resource_binding'
  resourceId?: string
  message: string
}>

export type ProfileCompatibilityResult =
  | Readonly<{ ok: true; issues: readonly [] }>
  | Readonly<{ ok: false; issues: readonly ProfileCompatibilityIssue[] }>

export type CompatibilityResourceSet = Readonly<{
  skills: readonly MamSkillDefinition[]
  mcpServers: readonly McpServerProfile[]
  knowledgeBases: readonly Readonly<{
    profile: KnowledgeBaseProfile
    status: 'available' | 'degraded'
  }>[]
}>

export function validateProfileCompatibility(input: {
  role: RoleProfile
  executor: ExecutorProfile
  provider: ProviderProfile
  model: ModelProfile
  capabilities: ExecutorCapabilities
  resources: CompatibilityResourceSet
  availableSecretRefs: ReadonlySet<string>
}): ProfileCompatibilityResult {
  const capabilities = ExecutorCapabilitiesSchema.parse(input.capabilities)
  const issues: ProfileCompatibilityIssue[] = []
  if (!capabilities.supportedProtocols.includes(input.provider.protocol)) {
    issue(issues, 'protocol_unsupported', 'Executor does not support the Provider protocol')
  }
  if (input.provider.baseUrl && !capabilities.supportsCustomEndpoint) {
    issue(issues, 'custom_endpoint_unsupported', 'Executor cannot isolate a custom endpoint')
  }
  if (!capabilities.supportsModelOverride) {
    issue(issues, 'model_override_unsupported', 'Executor cannot select the bound Model Profile')
  }
  if (!capabilities.supportsPerInstanceConfig) {
    issue(
      issues,
      'per_instance_config_unsupported',
      'Executor cannot use an Attempt-specific configuration directory'
    )
  }
  if (!capabilities.supportsStructuredOutput) {
    issue(issues, 'structured_output_unsupported', 'Executor has no structured result interface')
  }
  if (!input.model.capabilities.supportsStructuredOutput) {
    issue(
      issues,
      'model_structured_output_unsupported',
      'Model Profile does not support the required structured result'
    )
  }
  if (input.resources.skills.length > 0 && !capabilities.supportsSkills) {
    issue(issues, 'skills_unsupported', 'Executor cannot materialize bound Skills')
  }
  for (const skill of input.resources.skills) {
    if (!skill.supportedExecutors.includes(input.executor.kind)) {
      issue(
        issues,
        'skill_executor_unsupported',
        'Skill does not support the selected Executor',
        skill.id
      )
    }
  }
  for (const server of input.resources.mcpServers) {
    if (!capabilities.supportedMcpTransports.includes(server.transport)) {
      issue(
        issues,
        'mcp_transport_unsupported',
        `Executor does not support MCP transport ${server.transport}`,
        server.id
      )
    }
  }
  if (input.resources.knowledgeBases.length > 0 && !capabilities.supportsKnowledgeGateway) {
    issue(
      issues,
      'knowledge_gateway_unsupported',
      'Executor cannot use the read-only Knowledge Gateway'
    )
  }
  validateBindings(input, capabilities, issues)
  return issues.length === 0 ? { ok: true, issues: [] } : { ok: false, issues }
}

function validateBindings(
  input: Parameters<typeof validateProfileCompatibility>[0],
  capabilities: ExecutorCapabilities,
  issues: ProfileCompatibilityIssue[]
): void {
  const resourceIds = [
    ...input.role.skillBindings.map((binding) => `skill:${binding.skillId}`),
    ...input.role.mcpBindings.map((binding) => `mcp:${binding.serverProfileId}`),
    ...input.role.knowledgeBaseBindings.map(
      (binding) => `knowledge:${binding.knowledgeBaseProfileId}`
    )
  ]
  for (const id of duplicateValues(resourceIds)) {
    issue(issues, 'duplicate_resource_binding', 'Role contains a duplicate resource binding', id)
  }
  const secretRefs = requiredSecretRefs(input)
  if (secretRefs.length > 0 && !capabilities.supportsPerInstanceCredentials) {
    issue(
      issues,
      'per_instance_credentials_unsupported',
      'Executor cannot isolate credentials for each Attempt'
    )
  }
  for (const secretRef of secretRefs) {
    if (!input.availableSecretRefs.has(secretRef)) {
      issue(
        issues,
        'secret_unavailable',
        'Required local secret reference is unavailable',
        secretRef
      )
    }
  }
  for (const binding of input.role.knowledgeBaseBindings) {
    const resolved = input.resources.knowledgeBases.find(
      (entry) => entry.profile.id === binding.knowledgeBaseProfileId
    )
    if (resolved?.status !== 'available') {
      issue(
        issues,
        'required_knowledge_unavailable',
        'Required Knowledge Base is unavailable on this machine',
        binding.knowledgeBaseProfileId
      )
    }
  }
}

function requiredSecretRefs(input: Parameters<typeof validateProfileCompatibility>[0]): string[] {
  const refs = [
    input.provider.secretRef,
    ...input.resources.mcpServers.map((profile) => profile.credentialRef),
    ...input.resources.knowledgeBases
      .filter((entry) => entry.status === 'available')
      .map((entry) => entry.profile.credentialRef)
  ].filter((value): value is string => Boolean(value))
  return [...new Set(refs)]
}

function duplicateValues(values: readonly string[]): string[] {
  const seen = new Set<string>()
  const duplicates = new Set<string>()
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value)
    seen.add(value)
  }
  return [...duplicates]
}

function issue(
  issues: ProfileCompatibilityIssue[],
  code: ProfileCompatibilityIssue['code'],
  message: string,
  resourceId?: string
): void {
  issues.push({ code, message, ...(resourceId ? { resourceId } : {}) })
}
