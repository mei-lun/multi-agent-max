import type { RoleProfile } from '../../../shared/mam/domain/role'
import type { WorkflowDefinition } from '../../../shared/mam/domain/workflow'
import type {
  MamDesignProposal,
  MamDesignValidationIssue,
  MamDesignWorkflowRevision
} from '../../../shared/mam/design-assistant'
import type { MamDesignProposalSpec } from '../../../shared/mam/design-proposal'
import type { ProfileCatalog } from '../profiles/profile-catalog'
import { profileContentHash } from '../profiles/profile-content-hash'
import { compileWorkflow } from '../workflow/workflow-compiler'
import {
  designExecutorResourceCapabilities,
  supportedDesignProviderProtocols
} from './mam-design-execution-bindings'
import { validateMamDesignDelivery } from './mam-design-delivery-validation'
import { validateMamDesignWorkflowIdentity } from './mam-design-workflow-identity-validation'
import { validateMamDesignMergeCommands } from './mam-design-merge-validation'

export function createMamDesignProposal(input: {
  roles: readonly RoleProfile[]
  workflow: WorkflowDefinition
  profiles: ProfileCatalog
  now: () => string
  source?: MamDesignProposalSpec
  workflowRevision?: MamDesignWorkflowRevision
}): MamDesignProposal {
  const roles = input.roles.map((role) => structuredClone(role))
  const workflow = structuredClone(input.workflow)
  return {
    hash: profileContentHash({ roles, workflow }),
    roles,
    workflow,
    issues: validateMamDesignProposal({
      roles,
      workflow,
      profiles: input.profiles,
      ...(input.workflowRevision ? { workflowRevision: input.workflowRevision } : {})
    }),
    ...(input.source ? { source: structuredClone(input.source) } : {}),
    createdAt: input.now()
  }
}

export function validateMamDesignProposal(input: {
  roles: readonly RoleProfile[]
  workflow: WorkflowDefinition
  profiles: ProfileCatalog
  workflowRevision?: MamDesignWorkflowRevision
}): MamDesignValidationIssue[] {
  const issues: MamDesignValidationIssue[] = []
  const roleIds = new Set<string>()
  for (const [index, role] of input.roles.entries()) {
    if (roleIds.has(role.id)) {
      add(issues, 'duplicate_role_id', 'error', `Generated Role ID is duplicated: ${role.id}`)
    }
    roleIds.add(role.id)
    if (input.profiles.roles.listVersions(role.id).length > 0) {
      add(
        issues,
        'role_id_exists',
        'error',
        `Role ID already exists: ${role.id}`,
        `roles.${index}.id`
      )
    }
    validateRole(role, index, input.profiles, issues)
  }
  issues.push(...validateMamDesignWorkflowIdentity(input))
  validateWorkflowRoleReferences(
    input.workflow,
    roleIds,
    input.workflowRevision ? input.profiles : undefined,
    issues
  )
  issues.push(...validateMamDesignMergeCommands(input.workflow))
  issues.push(...validateMamDesignDelivery(input.workflow))
  try {
    compileWorkflow(input.workflow)
  } catch (cause) {
    add(
      issues,
      errorCode(cause, 'workflow_compilation_failed'),
      'error',
      cause instanceof Error ? cause.message : String(cause),
      'workflow'
    )
  }
  return issues
}

function validateRole(
  role: RoleProfile,
  index: number,
  profiles: ProfileCatalog,
  issues: MamDesignValidationIssue[]
): void {
  const path = `roles.${index}`
  const executor = profiles.executors.getActive(role.execution.executorProfileId)
  const model = profiles.models.getActive(role.execution.modelProfileId)
  if (!executor) {
    add(
      issues,
      'executor_profile_not_found',
      'error',
      `Executor Profile is not active: ${role.execution.executorProfileId}`,
      `${path}.execution.executorProfileId`
    )
  }
  if (!model) {
    add(
      issues,
      'model_profile_not_found',
      'error',
      `Model Profile is not active: ${role.execution.modelProfileId}`,
      `${path}.execution.modelProfileId`
    )
  }
  const provider = model ? profiles.providers.getActive(model.providerProfileId) : undefined
  if (model && !provider) {
    add(
      issues,
      'provider_profile_not_found',
      'error',
      `Provider Profile is not active: ${model.providerProfileId}`,
      `${path}.execution.modelProfileId`
    )
  }
  if (model && !model.capabilities.supportsStructuredOutput) {
    add(
      issues,
      'model_structured_output_unsupported',
      'error',
      `Model does not support structured output: ${model.id}`,
      `${path}.execution.modelProfileId`
    )
  }
  if (
    executor &&
    provider &&
    !supportedDesignProviderProtocols(executor).includes(provider.protocol)
  ) {
    add(
      issues,
      'protocol_unsupported',
      'error',
      `${executor.kind} does not support ${provider.protocol}`,
      `${path}.execution`
    )
  }
  if (!role.systemPromptRef.startsWith('inline:') || !role.systemPromptRef.slice(7).trim()) {
    add(
      issues,
      'system_prompt_invalid',
      'error',
      'Generated Role instructions must be a non-empty inline prompt',
      `${path}.systemPromptRef`
    )
  }
  validateResourceIds(role, path, profiles, executor, issues)
  if (model?.capabilities.maxContextTokens) {
    if (role.contextPolicy.maxContextTokens > model.capabilities.maxContextTokens) {
      add(
        issues,
        'context_limit_exceeds_model',
        'warning',
        `Role context limit exceeds Model capability: ${model.id}`,
        `${path}.contextPolicy.maxContextTokens`
      )
    }
  }
}

function validateResourceIds(
  role: RoleProfile,
  path: string,
  profiles: ProfileCatalog,
  executor: ReturnType<ProfileCatalog['executors']['getActive']>,
  issues: MamDesignValidationIssue[]
): void {
  const capabilities = executor ? designExecutorResourceCapabilities(executor) : undefined
  validateDuplicateResourceBindings(role, path, issues)
  for (const binding of role.skillBindings) {
    const skill = profiles.skills.getActive(binding.skillId)
    if (!skill) {
      add(issues, 'skill_not_found', 'error', `Skill is not active: ${binding.skillId}`, path)
      continue
    }
    if (!skill.enabled) {
      add(issues, 'skill_disabled', 'error', `Skill is disabled: ${binding.skillId}`, path)
    }
    if (capabilities && !capabilities.supportsSkills) {
      add(issues, 'skills_unsupported', 'error', 'Executor cannot use bound Skills', path)
    }
    if (executor && !skill.supportedExecutors.includes(executor.kind)) {
      add(
        issues,
        'skill_executor_unsupported',
        'error',
        `Skill ${skill.id} does not support ${executor.kind}`,
        path
      )
    }
  }
  for (const binding of role.mcpBindings) {
    const server = profiles.mcpServers.getActive(binding.serverProfileId)
    if (!server) {
      add(
        issues,
        'mcp_not_found',
        'error',
        `MCP Server is not active: ${binding.serverProfileId}`,
        path
      )
    } else if (capabilities && !capabilities.supportedMcpTransports.includes(server.transport)) {
      add(
        issues,
        'mcp_transport_unsupported',
        'error',
        'Executor cannot use the selected MCP transport',
        path
      )
    }
  }
  for (const binding of role.knowledgeBaseBindings) {
    if (!profiles.knowledgeBases.getActive(binding.knowledgeBaseProfileId)) {
      add(
        issues,
        'knowledge_base_not_found',
        'error',
        `Knowledge Base is not active: ${binding.knowledgeBaseProfileId}`,
        path
      )
    } else if (capabilities && !capabilities.supportsKnowledgeGateway) {
      add(
        issues,
        'knowledge_gateway_unsupported',
        'error',
        'Executor cannot use the selected Knowledge Base',
        path
      )
    }
  }
}

function validateDuplicateResourceBindings(
  role: RoleProfile,
  path: string,
  issues: MamDesignValidationIssue[]
): void {
  const bindings = [
    ...role.skillBindings.map((binding) => `skill:${binding.skillId}`),
    ...role.mcpBindings.map((binding) => `mcp:${binding.serverProfileId}`),
    ...role.knowledgeBaseBindings.map((binding) => `knowledge:${binding.knowledgeBaseProfileId}`)
  ]
  const seen = new Set<string>()
  for (const binding of bindings) {
    if (seen.has(binding)) {
      add(
        issues,
        'duplicate_resource_binding',
        'error',
        `Resource is bound more than once: ${binding}`,
        path
      )
    }
    seen.add(binding)
  }
}

function validateWorkflowRoleReferences(
  workflow: WorkflowDefinition,
  generatedRoleIds: ReadonlySet<string>,
  profiles: ProfileCatalog | undefined,
  issues: MamDesignValidationIssue[]
): void {
  for (const node of workflow.nodes) {
    if (!('allowedRoleProfileIds' in node)) continue
    for (const id of [...node.allowedRoleProfileIds, ...node.recommendedRoleProfileIds]) {
      if (!generatedRoleIds.has(id) && !profiles?.roles.getActive(id)) {
        add(
          issues,
          'workflow_role_not_available',
          'error',
          `Workflow node ${node.id} references a Role unavailable to this proposal: ${id}`,
          `workflow.nodes.${node.id}`
        )
      }
    }
  }
}

function errorCode(cause: unknown, fallback: string): string {
  return typeof cause === 'object' && cause !== null && 'code' in cause
    ? String(cause.code)
    : fallback
}

function add(
  issues: MamDesignValidationIssue[],
  code: string,
  severity: MamDesignValidationIssue['severity'],
  message: string,
  path?: string
): void {
  issues.push({ code, severity, message, ...(path ? { path } : {}) })
}
