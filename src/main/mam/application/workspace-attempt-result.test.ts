import { execFileSync } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ArtifactContractSchema } from '../../../shared/mam/domain/artifact'
import { createGitCommandClient } from '../state-store/git-command-client'
import { collectWorkspaceAttemptResult } from './workspace-attempt-result'

const directories: string[] = []

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })))
})

describe('workspace Attempt result collection', () => {
  it('builds a standard result from a Markdown Task artifact', async () => {
    const workspace = await repository()
    await writeFile(
      join(workspace, 'design-spec.md'),
      '# Guessing game\n\n## 产品目标（product_goal）\nClear goal.\n\n## Rules（game_rules）\nPlay.\n'
    )
    const git = createGitCommandClient()
    const result = await collectWorkspaceAttemptResult({
      workspacePath: workspace,
      baseCommit: git.run(workspace, ['rev-parse', 'HEAD^{commit}']),
      outputContracts: [
        ArtifactContractSchema.parse({
          schemaVersion: '1.0.0',
          artifactType: 'artifact.design-spec',
          format: 'markdown',
          required: true,
          maxBytes: 100_000,
          requiredSections: ['product_goal', 'game_rules']
        })
      ],
      git,
      authority: authority(),
      usage: { status: 'known', inputTokens: 8, outputTokens: 13, costUsd: 0.001 }
    })

    expect(result.result).toMatchObject({
      summary: 'MAM verified 1 workspace output artifact(s).',
      artifacts: [
        {
          contractId: 'artifact.design-spec',
          contentRef: 'workspace:design-spec.md'
        }
      ]
    })
    expect(result.contents.get('artifact.design-spec')?.value).toContain('产品目标')
  })
})

async function repository(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'mam-workspace-result-'))
  directories.push(directory)
  git(directory, ['init'])
  git(directory, ['config', 'user.name', 'MAM Test'])
  git(directory, ['config', 'user.email', 'mam@example.invalid'])
  await writeFile(join(directory, 'README.md'), '# Base\n')
  git(directory, ['add', 'README.md'])
  git(directory, ['commit', '-m', 'Initialize'])
  return directory
}

function authority() {
  return {
    workflowRunId: 'run.workspace',
    nodeRunId: 'node-run.workspace',
    taskId: 'task.workspace',
    attemptId: 'attempt.workspace',
    roleInstanceId: 'role-instance.workspace',
    executorInvocationId: 'invocation.workspace',
    effectiveConfigHash: 'a'.repeat(64),
    createdAt: '2026-07-31T00:00:00Z'
  }
}

function git(cwd: string, args: readonly string[]): void {
  execFileSync('git', args, { cwd, stdio: 'ignore' })
}
