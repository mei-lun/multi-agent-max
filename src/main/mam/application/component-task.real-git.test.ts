import { test, expect, vi } from 'vitest'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { createAttemptExecutionAcceptanceFixture } from './test-fixtures/attempt-execution-acceptance-fixture'
import { MamAttemptExecutionService } from './mam-attempt-execution-service'
import { AttemptResourceMaterializer } from '../profiles/attempt-resource-materializer'
import { AttemptArtifactValidator } from './attempt-artifact-validator'
import { LocalArtifactStore } from '../artifacts/local-artifact-store'
import { DiagnosticsRecorder } from '../diagnostics/diagnostics-recorder'
import { ExecutorLocalPreflight } from '../executors/executor-local-preflight'
import { buildAttemptResult } from '../artifacts/attempt-result-builder'
import { compileWorkflow } from '../workflow/workflow-compiler'
import type { ComponentExecutionPort } from './component-execution-port'
test('component task uses normal claim/attempt/artifact delivery without model executor or CLI preflight', async () => {
  const f = createAttemptExecutionAcceptanceFixture({ componentTask: true })
  const execute = vi.fn(async () => {
    throw new Error('Model must not execute')
  })
  const probe = vi.fn(() => {
    throw new Error('CLI must not preflight')
  })
  let finished!: () => void
  const completed = new Promise<void>((resolve) => {
    finished = resolve
  })
  const componentExecute = vi.fn(
    async (input: Parameters<ComponentExecutionPort['execute']>[0]) => {
      expect(input.component.params.modelProfileId).toBe('model.test')
      expect(input.authority.taskId).toBe(f.taskId)
      const patch =
        'diff --git a/README.md b/README.md\n--- a/README.md\n+++ b/README.md\n@@ -1 +1 @@\n-# before\n+# after\n'
      await mkdir(join(input.workspace, '.mam-artifacts'), { recursive: true })
      await writeFile(join(input.workspace, '.mam-artifacts', 'change.diff'), patch)
      await writeFile(join(input.workspace, 'README.md'), '# after\n')
      return {
        invocation: {},
        events: [],
        usage: { status: 'known' as const, inputTokens: 0, outputTokens: 0, costUsd: 0 },
        stderr: '',
        result: buildAttemptResult(
          {
            schemaVersion: '1.0.0',
            status: 'submitted',
            summary: 'Native result',
            verifications: [],
            risks: [],
            followUps: [],
            artifacts: [
              {
                contractId: 'artifact.patch',
                type: 'artifact.patch',
                contentRef: '.mam-artifacts/change.diff',
                sha256: createHash('sha256').update(patch).digest('hex')
              }
            ],
            usage: { status: 'known', inputTokens: 0, outputTokens: 0, costUsd: 0 }
          },
          input.authority
        )
      }
    }
  )
  try {
    f.settings.save({ ...f.settings.get(), executorBindings: [] })
    const service = new MamAttemptExecutionService({
      query: f.query,
      catalog: f.catalog,
      settings: f.settings,
      executor: { execute },
      componentExecutor: { execute: componentExecute },
      resources: new AttemptResourceMaterializer(join(f.root, 'resources')),
      artifacts: new AttemptArtifactValidator(new LocalArtifactStore(join(f.root, 'artifacts'))),
      diagnostics: new DiagnosticsRecorder(),
      workspaceRoot: join(f.root, 'worktrees'),
      repository: f.repository,
      preflight: new ExecutorLocalPreflight(probe),
      now: () => '2026-07-28T23:02:00Z',
      onStateChanged: finished
    })
    await service.start({ workflowRunId: f.bundle.run.id, taskId: f.taskId })
    await completed
    expect(execute).not.toHaveBeenCalled()
    expect(probe).not.toHaveBeenCalled()
    expect(componentExecute).toHaveBeenCalledOnce()
    expect(f.query.getSnapshot().runs[0]!.attempts[0]!.status).toBe('submitted')
    const changed = structuredClone(f.bundle.definition)
    const node = changed.nodes.find((n) => n.type === 'component_task')!
    if (node.type === 'component_task') node.component.params.prompt = 'different'
    expect(compileWorkflow(changed).planHash).not.toBe(f.bundle.plan.planHash)
  } finally {
    f.dispose()
  }
}, 30000)
