import type { LocalSecretBinding } from '../../../shared/mam/domain/execution-profile'
import {
  EffectiveRoleConfigSnapshotSchema,
  type EffectiveRoleConfigSnapshot,
  type RoleProfile
} from '../../../shared/mam/domain/role'
import type {
  AttemptConfigResolutionInput,
  ResolvedKnowledgeResource,
  ResolvedMcpResource,
  ResolvedSkillPackage
} from './attempt-config-resolver'
import type { ProfileCatalog } from './profile-catalog'
import { profileContentHash } from './profile-content-hash'

type SnapshotInput = Readonly<{
  input: AttemptConfigResolutionInput
  role: RoleProfile
  executor: NonNullable<ReturnType<ProfileCatalog['executors']['getActive']>>
  provider: NonNullable<ReturnType<ProfileCatalog['providers']['getActive']>>
  model: NonNullable<ReturnType<ProfileCatalog['models']['getActive']>>
  skills: readonly ResolvedSkillPackage[]
  mcpResources: readonly ResolvedMcpResource[]
  knowledgeResources: readonly ResolvedKnowledgeResource[]
  localSecrets: readonly LocalSecretBinding[]
}>

export function buildEffectiveConfigSnapshot(
  catalog: ProfileCatalog,
  input: SnapshotInput
): EffectiveRoleConfigSnapshot {
  const localBindingIds = [
    ...input.skills.map((skill) => skill.localBinding.id),
    ...input.knowledgeResources.flatMap((resource) =>
      resource.localBinding ? [resource.localBinding.id] : []
    ),
    ...usedSecretBindings(input).map((binding) => binding.id)
  ]
  const base = {
    schemaVersion: '1.0.0' as const,
    id: `effective.${profileContentHash(input.input.attemptId).slice(0, 24)}`,
    workflowRunId: input.input.workflowRunId,
    taskId: input.input.taskId,
    attemptId: input.input.attemptId,
    roleProfile: profileRef(input.role, catalog.roles.contentHash(input.role)),
    executorProfile: {
      ...profileRef(input.executor, catalog.executors.contentHash(input.executor)),
      kind: input.executor.kind
    },
    providerProfile: profileRef(input.provider, catalog.providers.contentHash(input.provider)),
    modelProfile: profileRef(input.model, catalog.models.contentHash(input.model)),
    systemPromptRef: input.role.systemPromptRef,
    execution: {
      executableRef: input.executor.executableRef,
      adapterOptions: input.executor.adapterOptions,
      providerProtocol: input.provider.protocol,
      ...(input.provider.baseUrl && { providerBaseUrl: input.provider.baseUrl }),
      ...(input.provider.secretRef && { providerSecretRef: input.provider.secretRef }),
      ...(input.provider.headers && { providerHeaders: input.provider.headers }),
      remoteModelId: input.model.remoteModelId,
      modelCapabilities: input.model.capabilities,
      inference: {
        ...input.model.defaultInference,
        ...input.role.execution.inferenceOverrides
      }
    },
    skills: input.skills.map((skill) => ({
      id: skill.definition.id,
      version: skill.definition.version,
      contentDigest: skill.definition.contentDigest
    })),
    mcpBindings: input.mcpResources.map((resource) => ({
      ...resource.binding,
      version: resource.profile.version,
      contentHash: catalog.mcpServers.contentHash(resource.profile)
    })),
    knowledgeBaseBindings: input.knowledgeResources.map((resource) => ({
      ...resource.binding,
      version: resource.profile.version,
      contentHash: catalog.knowledgeBases.contentHash(resource.profile),
      ...knowledgeIndexRevision(resource),
      status: resource.status
    })),
    tools: input.role.tools,
    permissions: constrainedPermissions(input.role.permissions, input.input.workspaceMode),
    budget: input.role.budget,
    retry: input.role.retry,
    contextPolicy: input.role.contextPolicy,
    localBindingIds: [...new Set(localBindingIds)].sort(),
    createdAt: input.input.createdAt
  }
  return EffectiveRoleConfigSnapshotSchema.parse({
    ...base,
    contentHash: profileContentHash(base)
  })
}

function constrainedPermissions(
  permissions: RoleProfile['permissions'],
  workspaceMode: AttemptConfigResolutionInput['workspaceMode']
): RoleProfile['permissions'] {
  if (!workspaceMode || workspaceMode === 'write') return permissions
  return {
    ...permissions,
    ...(workspaceMode === 'none' ? { readPaths: [] } : {}),
    writePaths: []
  }
}

function profileRef(profile: { id: string; version: number }, contentHash: string) {
  return { id: profile.id, version: profile.version, contentHash }
}

function knowledgeIndexRevision(resource: ResolvedKnowledgeResource) {
  const indexRevision = resource.localBinding?.indexRevision ?? resource.profile.indexRevision
  return indexRevision ? { indexRevision } : {}
}

function usedSecretBindings(input: SnapshotInput): LocalSecretBinding[] {
  const refs = new Set(
    [
      input.provider.secretRef,
      ...input.mcpResources.map((resource) => resource.profile.credentialRef),
      ...input.knowledgeResources
        .filter((resource) => resource.status === 'available')
        .map((resource) => resource.profile.credentialRef)
    ].filter((value): value is string => Boolean(value))
  )
  return input.localSecrets.filter((binding) => refs.has(binding.secretRef))
}
