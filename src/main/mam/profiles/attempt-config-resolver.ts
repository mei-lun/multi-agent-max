import {
  ExecutorCapabilitiesSchema,
  LocalSecretBindingSchema,
  type ExecutorCapabilities,
  type LocalSecretBinding
} from '../../../shared/mam/domain/execution-profile'
import {
  LocalKnowledgeBindingSchema,
  type KnowledgeBaseProfile,
  type LocalKnowledgeBinding,
  type RoleKnowledgeBaseBinding,
  type RoleMcpBinding
} from '../../../shared/mam/domain/resource-profile'
import { type EffectiveRoleConfigSnapshot, type RoleProfile } from '../../../shared/mam/domain/role'
import {
  MamLocalSkillBindingSchema,
  type MamLocalSkillBinding,
  type MamSkillDefinition
} from '../../../shared/mam/domain/skill-definition'
import { validateSkillPackage } from '../skills/skill-package-validator'
import { buildEffectiveConfigSnapshot } from './effective-config-snapshot-builder'
import type { ProfileCatalog } from './profile-catalog'
import {
  validateProfileCompatibility,
  type ProfileCompatibilityIssue
} from './profile-compatibility-validator'

export type ResolvedSkillPackage = Readonly<{
  definition: MamSkillDefinition
  localBinding: MamLocalSkillBinding
}>

export type ResolvedMcpResource = Readonly<{
  binding: RoleMcpBinding
  profile: NonNullable<ReturnType<ProfileCatalog['mcpServers']['getActive']>>
}>

export type ResolvedKnowledgeResource = Readonly<{
  binding: RoleKnowledgeBaseBinding
  profile: KnowledgeBaseProfile
  localBinding?: LocalKnowledgeBinding
  status: 'available' | 'degraded'
}>

export type ResolvedAttemptConfig = Readonly<{
  snapshot: EffectiveRoleConfigSnapshot
  skills: readonly ResolvedSkillPackage[]
  mcpResources: readonly ResolvedMcpResource[]
  knowledgeResources: readonly ResolvedKnowledgeResource[]
}>

export type AttemptConfigResolutionInput = Readonly<{
  workflowRunId: string
  taskId: string
  attemptId: string
  roleProfileId: string
  roleProfileVersion: number
  roleProfile?: RoleProfile
  capabilities: ExecutorCapabilities
  localSecretBindings: readonly LocalSecretBinding[]
  localSkillBindings: readonly MamLocalSkillBinding[]
  localKnowledgeBindings: readonly LocalKnowledgeBinding[]
  createdAt: string
  workspaceMode?: 'none' | 'read' | 'write'
}>

export class AttemptConfigResolutionError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly issues: readonly ProfileCompatibilityIssue[] = []
  ) {
    super(message)
    this.name = 'AttemptConfigResolutionError'
  }
}

export class AttemptConfigResolver {
  constructor(private readonly catalog: ProfileCatalog) {}

  async resolve(input: AttemptConfigResolutionInput): Promise<ResolvedAttemptConfig> {
    const capabilities = ExecutorCapabilitiesSchema.parse(input.capabilities)
    const role = this.requireVersion(
      input.roleProfile ?? this.catalog.roles.get(input.roleProfileId, input.roleProfileVersion),
      'role_profile_not_found'
    )
    if (role.id !== input.roleProfileId || role.version !== input.roleProfileVersion) {
      throw new AttemptConfigResolutionError(
        'role_profile_mismatch',
        'Frozen Role Profile does not match the assigned Run catalog entry'
      )
    }
    const executor = this.requireVersion(
      this.catalog.executors.getActive(role.execution.executorProfileId),
      'executor_profile_not_found'
    )
    const model = this.requireVersion(
      this.catalog.models.getActive(role.execution.modelProfileId),
      'model_profile_not_found'
    )
    const provider = this.requireVersion(
      this.catalog.providers.getActive(model.providerProfileId),
      'provider_profile_not_found'
    )
    const localSecrets = input.localSecretBindings.map((binding) =>
      LocalSecretBindingSchema.parse(binding)
    )
    const localSkills = input.localSkillBindings.map((binding) =>
      MamLocalSkillBindingSchema.parse(binding)
    )
    const localKnowledge = input.localKnowledgeBindings.map((binding) =>
      LocalKnowledgeBindingSchema.parse(binding)
    )
    assertUniqueBindings(localSecrets, (binding) => binding.secretRef, 'ambiguous_secret_binding')
    assertUniqueBindings(localSkills, (binding) => binding.skillId, 'ambiguous_skill_binding')
    assertUniqueBindings(
      localKnowledge,
      (binding) => binding.knowledgeBaseProfileId,
      'ambiguous_knowledge_binding'
    )
    const skillDefinitions = this.resolveSkillDefinitions(role)
    const mcpResources = role.mcpBindings.map((binding) => ({
      binding,
      profile: this.requireVersion(
        this.catalog.mcpServers.getActive(binding.serverProfileId),
        'mcp_profile_not_found'
      )
    }))
    const knowledgeResources = role.knowledgeBaseBindings.map((binding) =>
      this.resolveKnowledge(binding, localKnowledge)
    )
    const compatibility = validateProfileCompatibility({
      role,
      executor,
      provider,
      model,
      capabilities,
      resources: {
        skills: skillDefinitions,
        mcpServers: mcpResources.map((resource) => resource.profile),
        knowledgeBases: knowledgeResources.map((resource) => ({
          profile: resource.profile,
          status: resource.status
        }))
      },
      availableSecretRefs: new Set(localSecrets.map((binding) => binding.secretRef))
    })
    if (!compatibility.ok) {
      throw new AttemptConfigResolutionError(
        compatibility.issues[0]!.code,
        compatibility.issues.map((issue) => issue.message).join('; '),
        compatibility.issues
      )
    }
    const skills = await this.resolveSkillPackages(role, skillDefinitions, localSkills)
    const snapshot = buildEffectiveConfigSnapshot(this.catalog, {
      input,
      role,
      executor,
      provider,
      model,
      skills,
      mcpResources,
      knowledgeResources,
      localSecrets
    })
    return { snapshot, skills, mcpResources, knowledgeResources }
  }

  private resolveSkillDefinitions(role: RoleProfile): MamSkillDefinition[] {
    return role.skillBindings.map((binding) => {
      const definition = this.requireVersion(
        this.catalog.skills.getActive(binding.skillId),
        'skill_definition_not_found'
      )
      if (!definition.enabled) {
        throw new AttemptConfigResolutionError(
          'skill_disabled',
          `Skill ${definition.id} is disabled`
        )
      }
      return definition
    })
  }

  private async resolveSkillPackages(
    role: RoleProfile,
    definitions: readonly MamSkillDefinition[],
    localBindings: readonly MamLocalSkillBinding[]
  ): Promise<ResolvedSkillPackage[]> {
    const result: ResolvedSkillPackage[] = []
    for (const [index, binding] of role.skillBindings.entries()) {
      const definition = definitions[index]!
      const localBinding = localBindings.find((entry) => entry.skillId === binding.skillId)
      if (!localBinding) {
        throw new AttemptConfigResolutionError(
          'skill_binding_unavailable',
          `Skill ${binding.skillId} has no local binding`
        )
      }
      const validated = await validateSkillPackage(localBinding.sourcePath)
      if (validated.contentDigest !== definition.contentDigest) {
        throw new AttemptConfigResolutionError(
          'skill_content_changed',
          `Skill ${binding.skillId} content does not match its registered digest`
        )
      }
      result.push({ definition, localBinding })
    }
    return result
  }

  private resolveKnowledge(
    binding: RoleKnowledgeBaseBinding,
    localBindings: readonly LocalKnowledgeBinding[]
  ): ResolvedKnowledgeResource {
    const profile = this.requireVersion(
      this.catalog.knowledgeBases.getActive(binding.knowledgeBaseProfileId),
      'knowledge_profile_not_found'
    )
    const localBinding = localBindings.find(
      (entry) => entry.knowledgeBaseProfileId === binding.knowledgeBaseProfileId
    )
    const requiresLocal = profile.kind === 'local-directory' || Boolean(profile.credentialRef)
    const status = requiresLocal && !localBinding ? 'degraded' : 'available'
    return { binding, profile, ...(localBinding ? { localBinding } : {}), status }
  }

  private requireVersion<T>(value: T | undefined, code: string): T {
    if (!value) throw new AttemptConfigResolutionError(code, code)
    return value
  }
}

function assertUniqueBindings<T>(
  bindings: readonly T[],
  identity: (binding: T) => string,
  code: string
): void {
  const seen = new Set<string>()
  for (const binding of bindings) {
    const id = identity(binding)
    if (seen.has(id)) {
      throw new AttemptConfigResolutionError(code, `Multiple local bindings exist for ${id}`)
    }
    seen.add(id)
  }
}
