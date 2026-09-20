import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { importWorkflowPackage } from './workflow-package-command'

const temporaryDirectories: string[] = []

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('Workflow package command', () => {
  it('rejects an imported revisable Review without a bounded return edge', () => {
    const root = mkdtempSync(join(tmpdir(), 'mam-workflow-package-'))
    temporaryDirectories.push(root)
    const path = join(root, 'workflow.json')
    writeFileSync(
      path,
      JSON.stringify({
        schemaVersion: '1.0.0',
        workflow: invalidWorkflow(),
        roles: [role('role.author'), role('role.reviewer')]
      })
    )

    expect(() =>
      importWorkflowPackage(path, {} as never, (code, message) =>
        Object.assign(new Error(message), { code })
      )
    ).toThrow(
      expect.objectContaining({
        code: 'workflow_package_invalid',
        message: expect.stringContaining('bounded changes_requested return edge')
      })
    )
  })
})

function invalidWorkflow() {
  return {
    schemaVersion: '1.0.0',
    id: 'workflow.invalid-review-loop',
    name: 'Invalid Review loop',
    version: 1,
    nodes: [
      {
        id: 'author',
        type: 'role_task',
        recommendedRoleProfileIds: ['role.author'],
        allowedRoleProfileIds: ['role.author'],
        instruction: 'Create the delivery.',
        workspaceMode: 'write',
        inputs: [],
        outputs: [
          {
            schemaVersion: '1.0.0',
            artifactType: 'artifact.delivery',
            format: 'diff',
            required: true,
            maxBytes: 1000
          }
        ]
      },
      {
        id: 'review',
        type: 'review_gate',
        recommendedRoleProfileIds: ['role.reviewer'],
        allowedRoleProfileIds: ['role.reviewer'],
        inputs: [
          { artifactId: 'artifact.delivery', version: 1, contentHash: 'a'.repeat(64) }
        ],
        reportContract: {
          schemaVersion: '1.0.0',
          artifactType: 'artifact.review',
          format: 'json-schema',
          required: true,
          maxBytes: 1000,
          jsonSchema: { type: 'object' }
        },
        minimumDecisions: 1,
        maxRevisionAttempts: 2
      },
      { id: 'finish', type: 'finish', inputs: [] }
    ],
    edges: [
      { from: 'author', to: 'review' },
      { from: 'review', to: 'finish' }
    ],
    maxTransitions: 10,
    maxRunCostUsd: 1,
    maxRunDurationSeconds: 60
  }
}

function role(id: string) {
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
    contextPolicy: {
      maxContextTokens: 100,
      compaction: 'disabled',
      includePreviousAttempts: false
    }
  }
}
