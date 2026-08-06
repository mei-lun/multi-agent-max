import { ArtifactContractSchema, type ArtifactContract } from '../../../shared/mam/domain/artifact'
import { RoleProfileSchema, type RoleProfile } from '../../../shared/mam/domain/role'
import {
  WorkflowDefinitionSchema,
  type WorkflowDefinition,
  type WorkflowNode
} from '../../../shared/mam/domain/workflow'
import {
  MamDesignProposalSpecSchema,
  type MamDesignProposalSpec
} from '../../../shared/mam/design-proposal'
import type { MamDesignWorkflowRevision } from '../../../shared/mam/design-assistant'
import { automaticReviewArtifactContract } from './automatic-review-contract'

const EMPTY_HASH = '0'.repeat(64)

export type MamDesignMaterializedProposal = Readonly<{
  roles: readonly RoleProfile[]
  workflow: WorkflowDefinition
}>

export type MamDesignProposalIdAllocator = (
  kind: 'role' | 'workflow',
  preferredId: string
) => string

export type MamDesignDefaultExecutionBinding = Readonly<{
  executorProfileId: string
  modelProfileId: string
}>

export type MamDesignProposalRevisionContext = Readonly<{
  revision: MamDesignWorkflowRevision
  existingRoleIds: readonly string[]
}>

export class MamDesignProposalMaterializationError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message)
    this.name = 'MamDesignProposalMaterializationError'
  }
}

export function materializeMamDesignProposal(
  input: unknown,
  allocateId: MamDesignProposalIdAllocator,
  defaultExecutionBinding?: MamDesignDefaultExecutionBinding,
  revisionContext?: MamDesignProposalRevisionContext
): MamDesignMaterializedProposal {
  const proposal = MamDesignProposalSpecSchema.parse(input)
  const roleIds = new Map(buildRoleIds(proposal, allocateId))
  for (const roleId of revisionContext?.existingRoleIds ?? []) {
    if (!roleIds.has(roleId)) roleIds.set(roleId, roleId)
  }
  const artifactTypes = buildArtifactTypes(proposal)
  const roles = proposal.roles.map((role) =>
    RoleProfileSchema.parse({
      schemaVersion: '1.0.0',
      id: roleIds.get(role.key),
      version: 1,
      displayName: role.displayName,
      execution: {
        executorProfileId: requireExecutionBinding(
          role.executorProfileId,
          defaultExecutionBinding?.executorProfileId,
          'executor'
        ),
        modelProfileId: requireExecutionBinding(
          role.modelProfileId,
          defaultExecutionBinding?.modelProfileId,
          'model'
        )
      },
      systemPromptRef: `inline:${role.instructions}`,
      skillBindings: role.skillIds.map((skillId) => ({ skillId })),
      mcpBindings: role.mcpServerIds.map((serverProfileId) => ({ serverProfileId })),
      knowledgeBaseBindings: role.knowledgeBaseIds.map((knowledgeBaseProfileId) => ({
        knowledgeBaseProfileId
      })),
      tools: role.tools,
      permissions: role.permissions,
      budget: role.budget,
      retry: role.retry,
      contextPolicy: role.contextPolicy
    })
  )
  const workflow = WorkflowDefinitionSchema.parse({
    schemaVersion: '1.0.0',
    id:
      revisionContext?.revision.workflowId ??
      allocateId('workflow', prefixedId('workflow', proposal.workflow.key)),
    name: proposal.workflow.name,
    version: revisionContext?.revision.nextVersion ?? 1,
    nodes: proposal.workflow.nodes.map((node) => materializeNode(node, roleIds, artifactTypes)),
    edges: proposal.workflow.edges,
    maxTransitions: proposal.workflow.maxTransitions,
    maxRunCostUsd: proposal.workflow.maxRunCostUsd,
    maxRunDurationSeconds: proposal.workflow.maxRunDurationSeconds
  })
  return { roles, workflow }
}

function buildRoleIds(
  proposal: MamDesignProposalSpec,
  allocateId: MamDesignProposalIdAllocator
): ReadonlyMap<string, string> {
  const ids = new Map<string, string>()
  for (const role of proposal.roles) {
    if (ids.has(role.key)) fail('duplicate_role_key', `Duplicate generated role key: ${role.key}`)
    ids.set(role.key, allocateId('role', prefixedId('role', role.key)))
  }
  return ids
}

function buildArtifactTypes(proposal: MamDesignProposalSpec): ReadonlyMap<string, string> {
  const types = new Map<string, string>()
  for (const node of proposal.workflow.nodes) {
    for (const artifact of nodeArtifacts(node)) {
      if (types.has(artifact.key)) {
        fail('duplicate_artifact_key', `Duplicate generated Artifact key: ${artifact.key}`)
      }
      types.set(artifact.key, prefixedId('artifact', artifact.key))
    }
  }
  return types
}

function nodeArtifacts(node: MamDesignProposalSpec['workflow']['nodes'][number]) {
  if (node.type === 'role_task' || node.type === 'artifact_transform' || node.type === 'command') {
    return node.outputs
  }
  if (node.type === 'dynamic_tasks') return [node.planContract]
  if (node.type === 'review_gate') return [node.reportContract]
  return []
}

function materializeNode(
  node: MamDesignProposalSpec['workflow']['nodes'][number],
  roleIds: ReadonlyMap<string, string>,
  artifactTypes: ReadonlyMap<string, string>
): WorkflowNode {
  if (node.type === 'role_task') {
    return {
      id: node.key,
      type: node.type,
      ...roleSelection(node, roleIds),
      instruction: node.instruction,
      workspaceMode: node.workspaceMode,
      inputs: node.inputArtifactKeys.map((key) => artifactRef(key, artifactTypes)),
      outputs: node.outputs.map((artifact) => artifactContract(artifact, artifactTypes))
    }
  }
  if (node.type === 'dynamic_tasks') {
    return {
      id: node.key,
      type: node.type,
      ...roleSelection(node, roleIds),
      planContract: artifactContract(node.planContract, artifactTypes),
      maxTasks: node.maxTasks
    }
  }
  if (node.type === 'review_gate') {
    return {
      id: node.key,
      type: node.type,
      ...roleSelection(node, roleIds),
      inputs: node.inputArtifactKeys.map((key) => artifactRef(key, artifactTypes)),
      reportContract: automaticReviewArtifactContract(
        artifactContract(node.reportContract, artifactTypes)
      ),
      minimumDecisions: node.minimumDecisions,
      maxRevisionAttempts: node.maxRevisionAttempts
    }
  }
  if (node.type === 'approval_gate') {
    return { id: node.key, type: node.type, prompt: node.prompt, options: node.options }
  }
  if (node.type === 'human_review_gate') {
    return {
      id: node.key,
      type: node.type,
      inputs: node.inputArtifactKeys.map((key) => artifactRef(key, artifactTypes)),
      instructions: node.instructions,
      revisionTargetNodeId: node.revisionTargetNodeKey,
      maxRevisionAttempts: node.maxRevisionAttempts
    }
  }
  if (node.type === 'condition') {
    return { id: node.key, type: node.type, expression: node.expression, branches: node.branches }
  }
  if (node.type === 'parallel') {
    return { id: node.key, type: node.type, branches: node.branches }
  }
  if (node.type === 'join') return { id: node.key, type: node.type, waitFor: node.waitFor }
  if (node.type === 'artifact_transform') {
    return {
      id: node.key,
      type: node.type,
      inputs: node.inputArtifactKeys.map((key) => artifactRef(key, artifactTypes)),
      outputs: node.outputs.map((artifact) => artifactContract(artifact, artifactTypes)),
      transform: node.transform
    }
  }
  if (node.type === 'command') {
    return {
      id: node.key,
      type: node.type,
      executable: node.executable,
      arguments: node.arguments,
      workingDirectory: node.workingDirectory,
      outputs: node.outputs.map((artifact) => artifactContract(artifact, artifactTypes))
    }
  }
  if (node.type === 'git_merge') {
    return {
      id: node.key,
      type: node.type,
      ...roleSelection(node, roleIds),
      targetBranch: node.targetBranch,
      orderBy: 'merge_ready_at',
      strategy: node.strategy,
      conflictPolicy: 'coordinator_attempt',
      validations: node.validations
    }
  }
  return {
    id: node.key,
    type: 'finish',
    inputs: node.inputArtifactKeys.map((key) => artifactRef(key, artifactTypes))
  }
}

function roleSelection(
  input: { recommendedRoleKeys: readonly string[]; allowedRoleKeys: readonly string[] },
  roleIds: ReadonlyMap<string, string>
) {
  const allowedRoleProfileIds = input.allowedRoleKeys.map((key) => requireRoleId(key, roleIds))
  const recommendedKeys =
    input.recommendedRoleKeys.length > 0 ? input.recommendedRoleKeys : input.allowedRoleKeys
  const recommendedRoleProfileIds = recommendedKeys.map((key) => requireRoleId(key, roleIds))
  const allowed = new Set(allowedRoleProfileIds)
  if (recommendedRoleProfileIds.some((id) => !allowed.has(id))) {
    fail('recommended_role_not_allowed', 'Every recommended Role must also be allowed')
  }
  return { recommendedRoleProfileIds, allowedRoleProfileIds }
}

function artifactContract(
  input: ReturnType<typeof nodeArtifacts>[number],
  artifactTypes: ReadonlyMap<string, string>
): ArtifactContract {
  return ArtifactContractSchema.parse({
    schemaVersion: '1.0.0',
    artifactType: requireArtifactType(input.key, artifactTypes),
    format: input.format,
    required: input.required,
    maxBytes: input.maxBytes,
    ...(input.jsonSchema ? { jsonSchema: input.jsonSchema } : {}),
    ...(input.requiredSections ? { requiredSections: input.requiredSections } : {}),
    ...(input.allowedGlobs ? { allowedGlobs: input.allowedGlobs } : {}),
    ...(input.format === 'json-schema' && !input.jsonSchema
      ? { jsonSchema: { type: 'object' } }
      : {}),
    ...(input.format === 'markdown' && !input.requiredSections
      ? { requiredSections: ['summary'] }
      : {}),
    ...(input.format === 'file-set' && !input.allowedGlobs ? { allowedGlobs: ['**/*'] } : {})
  })
}

function artifactRef(key: string, artifactTypes: ReadonlyMap<string, string>) {
  return {
    artifactId: requireArtifactType(key, artifactTypes),
    version: 1,
    contentHash: EMPTY_HASH
  }
}

function requireRoleId(key: string, roleIds: ReadonlyMap<string, string>): string {
  const id = roleIds.get(key)
  if (!id) fail('unknown_role_key', `Workflow references unknown generated Role key: ${key}`)
  return id
}

function requireArtifactType(key: string, artifactTypes: ReadonlyMap<string, string>): string {
  const type = artifactTypes.get(key)
  if (!type) fail('unknown_artifact_key', `Workflow references unknown Artifact key: ${key}`)
  return type
}

function requireExecutionBinding(
  value: string | undefined,
  fallback: string | undefined,
  kind: 'executor' | 'model'
): string {
  if (value) return value
  if (fallback) return fallback
  fail('missing_execution_binding', `Generated Role is missing a ${kind} Profile reference`)
}

function prefixedId(prefix: string, key: string): string {
  return key.startsWith(`${prefix}.`) ? key : `${prefix}.${key}`
}

function fail(code: string, message: string): never {
  throw new MamDesignProposalMaterializationError(code, message)
}
