import { describe, expect, it } from 'vitest'
import type { RoleProfile } from './domain/role'
import type { WorkflowDefinition } from './domain/workflow'
import {
  createMamWorkflowPackage,
  MamWorkflowPackageSchema,
  workflowRoleProfileIds
} from './workflow-package'

describe('Workflow package', () => {
  it('collects every Role bound by executable nodes', () => {
    const definition = workflow()
    expect(workflowRoleProfileIds(definition)).toEqual(['role.builder', 'role.reviewer'])
    expect(
      createMamWorkflowPackage(definition, [role('role.builder'), role('role.reviewer')])
    ).toMatchObject({
      workflow: definition,
      roles: [{ id: 'role.builder' }, { id: 'role.reviewer' }]
    })
  })

  it('rejects a package that cannot resolve a Workflow Role', () => {
    const result = MamWorkflowPackageSchema.safeParse({
      schemaVersion: '1.0.0',
      workflow: workflow(),
      roles: [role('role.builder')]
    })
    expect(result.success).toBe(false)
  })
})

function workflow(): WorkflowDefinition {
  return {
    schemaVersion: '1.0.0',
    id: 'workflow.package',
    name: 'Package workflow',
    version: 1,
    nodes: [
      {
        id: 'build',
        type: 'role_task',
        recommendedRoleProfileIds: ['role.builder'],
        allowedRoleProfileIds: ['role.builder'],
        instruction: 'Build',
        workspaceMode: 'write',
        inputs: [],
        outputs: [
          {
            schemaVersion: '1.0.0',
            artifactType: 'artifact.patch',
            format: 'diff',
            required: true,
            maxBytes: 100
          }
        ]
      },
      {
        id: 'review',
        type: 'review_gate',
        recommendedRoleProfileIds: ['role.reviewer'],
        allowedRoleProfileIds: ['role.reviewer'],
        inputs: [{ artifactId: 'artifact.patch', version: 1, contentHash: 'a'.repeat(64) }],
        reportContract: {
          schemaVersion: '1.0.0',
          artifactType: 'artifact.review',
          format: 'test-report',
          required: true,
          maxBytes: 100
        },
        minimumDecisions: 1,
        maxRevisionAttempts: 1
      },
      { id: 'finish', type: 'finish', inputs: [] }
    ],
    edges: [
      { from: 'build', to: 'review' },
      { from: 'review', to: 'finish' }
    ],
    maxTransitions: 10,
    maxRunCostUsd: 1,
    maxRunDurationSeconds: 60
  }
}

function role(id: string): RoleProfile {
  return {
    schemaVersion: '1.0.0',
    id,
    version: 1,
    displayName: id,
    execution: { executorProfileId: 'executor.pi', modelProfileId: 'model.default' },
    systemPromptRef: 'prompt.default',
    skillBindings: [],
    mcpBindings: [],
    knowledgeBaseBindings: [],
    tools: [],
    permissions: {
      readPaths: ['.'],
      writePaths: ['.'],
      allowedCommands: ['git'],
      deniedCommands: [],
      allowedNetworkHosts: [],
      requireApprovalFor: []
    },
    budget: {
      maxInputTokens: 100,
      maxOutputTokens: 100,
      maxCostUsd: 1,
      maxDurationSeconds: 60
    },
    retry: { maxAttempts: 1, initialBackoffMs: 0, maxBackoffMs: 0 },
    contextPolicy: { maxContextTokens: 100, compaction: 'disabled', includePreviousAttempts: false }
  }
}
