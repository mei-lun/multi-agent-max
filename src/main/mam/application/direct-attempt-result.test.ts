import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ArtifactContractSchema } from '../../../shared/mam/domain/artifact'
import {
  collectDirectAttemptResult,
  materializeDirectAttemptResult
} from './direct-attempt-result'

const directories: string[] = []

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })))
})

describe('direct Attempt result collection', () => {
  it('turns a read-only Role response into its Markdown Artifact', async () => {
    const collected = collectDirectAttemptResult({
      text: '# 猜数字游戏\n\n## 产品目标（product_goal）\n清晰目标。\n\n## 规则（game_rules）\n开始游戏。',
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
      authority: authority(),
      usage: { status: 'known', inputTokens: 8, outputTokens: 13 }
    })

    expect(collected.result).toMatchObject({
      status: 'submitted',
      artifacts: [
        {
          contractId: 'artifact.design-spec',
          contentRef: 'artifact.design-spec.md'
        }
      ]
    })
    expect(collected.contents.get('artifact.design-spec')?.value).toContain('产品目标')
    const workspace = await mkdtemp(join(tmpdir(), 'mam-direct-result-'))
    directories.push(workspace)
    await materializeDirectAttemptResult(workspace, collectedContract(), collected.contents)
    expect(await readFile(join(workspace, 'artifact.design-spec.md'), 'utf8')).toContain('产品目标')
  })

  it('does not treat code diff contracts as direct text', () => {
    expect(() =>
      collectDirectAttemptResult({
        text: 'diff --git a/a b/a',
        outputContracts: [
          ArtifactContractSchema.parse({
            schemaVersion: '1.0.0',
            artifactType: 'artifact.implementation',
            format: 'diff',
            required: true,
            maxBytes: 100_000
          })
        ],
        authority: authority(),
        usage: { status: 'unknown' }
      })
    ).toThrow('direct_artifact_output_unsupported:diff')
  })
})

function collectedContract() {
  return [
    ArtifactContractSchema.parse({
      schemaVersion: '1.0.0',
      artifactType: 'artifact.design-spec',
      format: 'markdown',
      required: true,
      maxBytes: 100_000,
      requiredSections: ['product_goal', 'game_rules']
    })
  ]
}

function authority() {
  return {
    workflowRunId: 'run.direct',
    nodeRunId: 'node-run.direct',
    taskId: 'task.direct',
    attemptId: 'attempt.direct',
    roleInstanceId: 'role-instance.direct',
    executorInvocationId: 'invocation.direct',
    effectiveConfigHash: 'a'.repeat(64),
    createdAt: '2026-07-31T00:00:00Z'
  }
}
