import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { WorkflowDefinition } from '../../../shared/mam/domain/workflow'
import { createWorkflowRunBundle } from '../application/workflow-run-factory'
import { GitRunBundleStore } from './git-run-bundle-store'

const temporaryDirectories: string[] = []

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('Git Run Bundle store', () => {
  it('loads a frozen legacy Run whose Review lacks a return edge', () => {
    const root = mkdtempSync(join(tmpdir(), 'mam-run-bundle-legacy-'))
    temporaryDirectories.push(root)
    const bundle = createWorkflowRunBundle({
      runId: 'run.legacy-review',
      definition: legacyWorkflow(),
      roleCatalog: [
        { roleProfileId: 'role.author', roleProfileVersion: 1, contentHash: 'a'.repeat(64) },
        { roleProfileId: 'role.reviewer', roleProfileVersion: 1, contentHash: 'b'.repeat(64) }
      ],
      createdAt: '2026-09-17T00:00:00Z',
      enforceReviewReturnEdges: false
    })
    const runDirectory = join(root, 'runs', bundle.run.id)
    mkdirSync(runDirectory, { recursive: true })
    writeFileSync(join(runDirectory, 'run-bundle.json'), JSON.stringify(bundle))

    expect(new GitRunBundleStore(root).load(bundle.run.id)?.bundleHash).toBe(bundle.bundleHash)
  })
})

function legacyWorkflow(): WorkflowDefinition {
  return {
    schemaVersion: '1.0.0',
    id: 'workflow.legacy-review',
    name: 'Legacy Review',
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
          { artifactId: 'artifact.delivery', version: 1, contentHash: 'c'.repeat(64) }
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
