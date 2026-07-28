import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { WorkflowDefinition } from '../../../shared/mam/domain/workflow'
import { GitCommandRetryCoordinator } from '../state-store/git-command-retry-coordinator'
import { GitStateRepository } from '../state-store/git-state-repository'
import { advanceReadySystemNodes } from './system-node-advancement'
import { createWorkflowRunBundle, createWorkflowRunCommand } from './workflow-run-factory'
import { projectWorkflowRun } from './workflow-run-projection'

const temporaryDirectories: string[] = []

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('system node advancement with real Git state', () => {
  it('persists command output, feeds a transform and completes after replay', () => {
    const project = createProject()
    const repository = GitStateRepository.attach(project)
    const bundle = createWorkflowRunBundle({
      runId: 'run.system-nodes',
      definition: workflow(),
      roleCatalog: [],
      createdAt: '2026-07-29T00:00:00Z'
    })
    new GitCommandRetryCoordinator(repository).executeAndPush({
      command: createWorkflowRunCommand({
        bundle,
        commandId: 'command.create-system-run',
        schedulerId: 'scheduler.desktop',
        issuedAt: '2026-07-29T00:00:00Z'
      }),
      schedulerId: 'scheduler.desktop',
      runBundle: bundle
    })
    let commandNumber = 0

    const completed = advanceReadySystemNodes({
      repository,
      workflowRunId: bundle.run.id,
      schedulerId: 'scheduler.desktop',
      nextCommandId: () => `command.system.${String((commandNumber += 1))}`,
      now: () => `2026-07-29T00:00:0${String(commandNumber)}Z`
    })

    expect(completed).toEqual(['produce', 'normalize'])
    const projection = repository.rebuild(bundle.run.id)
    expect(projection.systemNodeExecutions.produce).toMatchObject({
      status: 'passed',
      commandEvidence: { exitCode: 0 }
    })
    const transformed = projection.systemNodeExecutions.normalize?.artifacts[0]!
    expect(
      JSON.parse(repository.readStateArtifact(transformed.storageRef).toString('utf8'))
    ).toEqual({ approved: true })
    expect(projectWorkflowRun(bundle, projection, '2026-07-29T00:01:00Z').run.status).toBe(
      'completed'
    )
  })

  it('records failed command evidence as a blocked system node', () => {
    const project = createProject()
    const definition = workflow()
    const produce = definition.nodes.find((node) => node.id === 'produce')
    if (!produce || produce.type !== 'command') throw new Error('command_fixture_missing')
    const bundle = createWorkflowRunBundle({
      runId: 'run.blocked-command',
      definition: {
        ...definition,
        nodes: definition.nodes.map((node) =>
          node.id === produce.id ? { ...node, arguments: ['-e', 'process.exit(7)'] } : node
        )
      },
      roleCatalog: [],
      createdAt: '2026-07-29T00:00:00Z'
    })
    const repository = GitStateRepository.attach(project)
    new GitCommandRetryCoordinator(repository).executeAndPush({
      command: createWorkflowRunCommand({
        bundle,
        commandId: 'command.create-blocked-system-run',
        schedulerId: 'scheduler.desktop',
        issuedAt: '2026-07-29T00:00:00Z'
      }),
      schedulerId: 'scheduler.desktop',
      runBundle: bundle
    })

    const completed = advanceReadySystemNodes({
      repository,
      workflowRunId: bundle.run.id,
      schedulerId: 'scheduler.desktop',
      nextCommandId: () => 'command.system.blocked',
      now: () => '2026-07-29T00:00:01Z'
    })

    expect(completed).toEqual(['produce'])
    expect(repository.rebuild(bundle.run.id).systemNodeExecutions.produce).toMatchObject({
      status: 'blocked',
      failureCode: 'command_exit_nonzero',
      commandEvidence: { exitCode: 7 }
    })
  })
})

function workflow(): WorkflowDefinition {
  const output = (artifactType: string) => ({
    schemaVersion: '1.0.0' as const,
    artifactType,
    format: 'json-schema' as const,
    required: true,
    maxBytes: 10_000,
    jsonSchema: { type: 'object' }
  })
  return {
    schemaVersion: '1.0.0',
    id: 'workflow.system-nodes',
    name: 'System nodes',
    version: 1,
    nodes: [
      {
        id: 'produce',
        type: 'command',
        executable: process.execPath,
        arguments: ['-e', 'process.stdout.write(JSON.stringify({ approved: true }))'],
        workingDirectory: '.',
        outputs: [output('artifact.command-output')]
      },
      {
        id: 'normalize',
        type: 'artifact_transform',
        inputs: [
          {
            artifactId: 'artifact.command-output',
            version: 1,
            contentHash: 'a'.repeat(64)
          }
        ],
        outputs: [output('artifact.normalized')],
        transform: 'identity'
      },
      { id: 'finish', type: 'finish', inputs: [] }
    ],
    edges: [
      { from: 'produce', to: 'normalize' },
      { from: 'normalize', to: 'finish' }
    ],
    maxTransitions: 10,
    maxRunCostUsd: 1,
    maxRunDurationSeconds: 600
  }
}

function createProject(): string {
  const root = mkdtempSync(join(tmpdir(), 'mam-system-nodes-'))
  temporaryDirectories.push(root)
  const remote = join(root, 'origin.git')
  const project = join(root, 'project')
  git(root, ['init', '--bare', remote])
  mkdirSync(project)
  git(project, ['init'])
  git(project, ['config', 'user.name', 'MAM System Node Test'])
  git(project, ['config', 'user.email', 'mam-system@example.invalid'])
  writeFileSync(join(project, 'README.md'), '# fixture\n')
  git(project, ['add', 'README.md'])
  git(project, ['commit', '-m', 'fixture: initialize'])
  git(project, ['branch', '-M', 'main'])
  git(project, ['remote', 'add', 'origin', remote])
  git(project, ['push', '-u', 'origin', 'main'])
  return project
}

function git(directory: string, args: readonly string[]): string {
  return execFileSync('git', ['-c', 'maintenance.auto=false', ...args], {
    cwd: directory,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  }).trim()
}
