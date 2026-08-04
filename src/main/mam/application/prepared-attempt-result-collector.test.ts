import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { GitCommandClient } from '../state-store/git-command-client'
import type { PreparedAttempt } from './mam-attempt-execution-types'
import { collectPreparedAttemptResult } from './prepared-attempt-result-collector'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true }))
  )
})

describe('prepared Attempt result collection', () => {
  it('materializes a single structured assistant output when a writable Role omitted the file', async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), 'mam-result-'))
    temporaryDirectories.push(workspacePath)
    const prepared = {
      snapshot: { permissions: { writePaths: ['.'] } },
      task: {
        outputContracts: [
          {
            schemaVersion: '1.0.0',
            artifactType: 'artifact.design-spec',
            format: 'json-schema',
            required: true,
            maxBytes: 10_000,
            jsonSchema: { type: 'object', required: ['title'] }
          }
        ]
      },
      worktree: { path: workspacePath, baseCommit: 'abcdef1' }
    } as unknown as PreparedAttempt
    const git = {
      runRaw: () => '',
      run: () => ''
    } as unknown as GitCommandClient

    const collected = await collectPreparedAttemptResult({
      prepared,
      assistantText: '```json\n{"title":"Guessing game"}\n```',
      usage: { status: 'unknown' },
      git,
      authority: {
        workflowRunId: 'run.test',
        nodeRunId: 'node-run.test',
        taskId: 'task.test',
        attemptId: 'attempt.test',
        roleInstanceId: 'role-instance.test',
        executorInvocationId: 'executor-invocation.test',
        effectiveConfigHash: 'a'.repeat(64),
        createdAt: '2026-08-03T00:00:00.000Z'
      }
    })

    expect(collected.result.artifacts).toHaveLength(1)
    expect(
      JSON.parse(await readFile(join(workspacePath, 'artifact.design-spec.json'), 'utf8'))
    ).toEqual({ title: 'Guessing game' })
  })
})
