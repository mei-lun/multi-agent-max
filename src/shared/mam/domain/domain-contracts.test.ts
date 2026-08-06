import { describe, expect, it } from 'vitest'
import { ArtifactVersionSchema } from './artifact'
import { EffectiveRoleConfigSnapshotSchema, RoleProfileSchema } from './role'
import { WorkflowDefinitionSchema } from './workflow'

const hash = 'a'.repeat(64)

describe('MAM domain contracts', () => {
  it('keeps Role Profiles flat and rejects inheritance fields', () => {
    const role = roleProfile()
    expect(RoleProfileSchema.parse(role)).toEqual(role)
    expect(RoleProfileSchema.safeParse({ ...role, parentRoleId: 'role.parent' }).success).toBe(
      false
    )
  })

  it('migrates legacy resource restrictions to resource selections', () => {
    const parsed = RoleProfileSchema.parse({
      ...roleProfile(),
      mcpBindings: [
        {
          serverProfileId: 'mcp.office',
          allowedTools: ['office.write'],
          allowedResources: [],
          allowedPrompts: ['prompt.requirements']
        }
      ],
      knowledgeBaseBindings: [
        {
          knowledgeBaseProfileId: 'knowledge.product',
          collections: ['requirements'],
          allowedOperations: ['search', 'read'],
          retrievalPolicy: { topK: 5, maxContextTokens: 8_000 },
          required: true
        }
      ]
    })

    expect(parsed.mcpBindings).toEqual([{ serverProfileId: 'mcp.office' }])
    expect(parsed.knowledgeBaseBindings).toEqual([{ knowledgeBaseProfileId: 'knowledge.product' }])
  })

  it('records exact resource versions in an Attempt snapshot and rejects secret values', () => {
    const snapshot = effectiveSnapshot()
    expect(EffectiveRoleConfigSnapshotSchema.parse(snapshot)).toMatchObject({
      roleProfile: { id: 'role.developer', version: 2 },
      executorProfile: { id: 'executor.codex', version: 4, kind: 'codex-cli' },
      modelProfile: { id: 'model.sol', version: 7 }
    })
    expect(
      EffectiveRoleConfigSnapshotSchema.safeParse({ ...snapshot, secretValue: 'not-allowed' })
        .success
    ).toBe(false)
  })

  it('accepts bounded workflow cycles and rejects unbounded cycles', () => {
    const workflow = workflowDefinition()
    expect(WorkflowDefinitionSchema.safeParse(workflow).success).toBe(true)
    const unbounded = {
      ...workflow,
      edges: workflow.edges.map((edge) => ({ from: edge.from, to: edge.to }))
    }
    expect(WorkflowDefinitionSchema.safeParse(unbounded).success).toBe(false)
  })

  it('requires every executable node to bind exactly one fixed Role', () => {
    const workflow = workflowDefinition()
    const node = workflow.nodes[0]!
    expect(
      WorkflowDefinitionSchema.safeParse({
        ...workflow,
        nodes: [
          {
            ...node,
            recommendedRoleProfileIds: ['role.developer'],
            allowedRoleProfileIds: ['role.reviewer']
          },
          workflow.nodes[1]!
        ]
      }).success
    ).toBe(false)
    expect(
      WorkflowDefinitionSchema.safeParse({
        ...workflow,
        nodes: [
          {
            ...node,
            recommendedRoleProfileIds: ['role.developer', 'role.reviewer'],
            allowedRoleProfileIds: ['role.developer', 'role.reviewer']
          },
          workflow.nodes[1]!
        ]
      }).success
    ).toBe(false)
  })

  it('requires a human review gate to return to one fixed role task through a bounded edge', () => {
    const workflow = workflowDefinition()
    const gate = {
      id: 'human-review',
      type: 'human_review_gate',
      inputs: [{ artifactId: 'artifact.output', version: 1, contentHash: hash }],
      instructions: 'Review the submitted result.',
      revisionTargetNodeId: 'implementation',
      maxRevisionAttempts: 3
    }
    const definition = {
      ...workflow,
      nodes: [workflow.nodes[0]!, gate, workflow.nodes[1]!],
      edges: [
        { from: 'implementation', to: 'human-review' },
        { from: 'human-review', to: 'finish', when: 'approved' },
        {
          from: 'human-review',
          to: 'implementation',
          when: 'changes_requested',
          maxTraversals: 3
        }
      ]
    }
    expect(WorkflowDefinitionSchema.safeParse(definition).success).toBe(true)
    expect(
      WorkflowDefinitionSchema.safeParse({
        ...definition,
        edges: definition.edges.filter((edge) => edge.when !== 'changes_requested')
      }).success
    ).toBe(false)
  })

  it('requires every Artifact version to identify its Task and availability', () => {
    const artifact = {
      schemaVersion: '1.0.0',
      id: 'artifact.1',
      artifactType: 'source.diff',
      version: 1,
      workflowRunId: 'run.1',
      nodeRunId: 'node-run.1',
      taskId: 'task.1',
      attemptId: 'attempt.1',
      roleInstanceId: 'role-instance.1',
      format: 'diff',
      contentHash: hash,
      byteSize: 1,
      storageRef: 'git:abc1234',
      availability: 'git',
      inputs: [],
      validationStatus: 'valid',
      createdAt: '2026-07-27T10:00:00Z'
    }
    expect(ArtifactVersionSchema.parse(artifact)).toEqual(artifact)
    const { taskId: _, ...withoutTask } = artifact
    expect(ArtifactVersionSchema.safeParse(withoutTask).success).toBe(false)
  })
})

function roleProfile() {
  return {
    schemaVersion: '1.0.0' as const,
    id: 'role.developer',
    version: 2,
    displayName: 'Developer',
    execution: { executorProfileId: 'executor.codex', modelProfileId: 'model.sol' },
    systemPromptRef: 'prompt.developer',
    skillBindings: [{ skillId: 'skill.typescript' }],
    mcpBindings: [],
    knowledgeBaseBindings: [],
    tools: ['shell'],
    permissions: {
      readPaths: ['.'],
      writePaths: ['.'],
      allowedCommands: ['pnpm'],
      deniedCommands: [],
      allowedNetworkHosts: [],
      requireApprovalFor: []
    },
    budget: {
      maxInputTokens: 100_000,
      maxOutputTokens: 20_000,
      maxCostUsd: 10,
      maxDurationSeconds: 3600
    },
    retry: { maxAttempts: 2, initialBackoffMs: 1000, maxBackoffMs: 5000 },
    contextPolicy: {
      maxContextTokens: 100_000,
      compaction: 'executor' as const,
      includePreviousAttempts: true
    }
  }
}

function effectiveSnapshot() {
  const profileRef = { id: 'profile', version: 1, contentHash: hash }
  return {
    schemaVersion: '1.0.0',
    id: 'config.attempt.1',
    workflowRunId: 'run.1',
    taskId: 'task.1',
    attemptId: 'attempt.1',
    roleProfile: { ...profileRef, id: 'role.developer', version: 2 },
    executorProfile: { ...profileRef, id: 'executor.codex', version: 4, kind: 'codex-cli' },
    providerProfile: { ...profileRef, id: 'provider.openai', version: 3 },
    modelProfile: { ...profileRef, id: 'model.sol', version: 7 },
    systemPromptRef: 'prompt.developer',
    execution: {
      executableRef: 'codex',
      adapterOptions: {},
      providerProtocol: 'openai-responses',
      providerBaseUrl: 'https://api.example.test/v1',
      providerSecretRef: 'secret.openai',
      remoteModelId: 'gpt-5.6-sol',
      modelCapabilities: {
        modalities: ['text'],
        supportsTools: true,
        supportsStructuredOutput: true
      },
      inference: { reasoningEffort: 'high' }
    },
    skills: [{ id: 'skill.typescript', version: 5, contentDigest: hash }],
    mcpBindings: [],
    knowledgeBaseBindings: [],
    tools: ['shell'],
    permissions: roleProfile().permissions,
    budget: roleProfile().budget,
    retry: roleProfile().retry,
    contextPolicy: roleProfile().contextPolicy,
    localBindingIds: ['binding.codex'],
    contentHash: hash,
    createdAt: '2026-07-27T10:00:00Z'
  }
}

function workflowDefinition() {
  return {
    schemaVersion: '1.0.0',
    id: 'workflow.1',
    name: 'Bounded review loop',
    version: 1,
    nodes: [
      {
        id: 'implementation',
        type: 'role_task',
        recommendedRoleProfileIds: ['role.developer'],
        allowedRoleProfileIds: ['role.developer'],
        instruction: 'Implement the task.',
        workspaceMode: 'write',
        inputs: [],
        outputs: [artifactContract()]
      },
      { id: 'finish', type: 'finish', inputs: [] }
    ],
    edges: [
      { from: 'implementation', to: 'finish' },
      { from: 'finish', to: 'implementation', maxTraversals: 2 }
    ],
    maxTransitions: 20,
    maxRunCostUsd: 20,
    maxRunDurationSeconds: 7200
  }
}

function artifactContract() {
  return {
    schemaVersion: '1.0.0',
    artifactType: 'source.diff',
    format: 'diff',
    required: true,
    maxBytes: 1_000_000
  }
}
