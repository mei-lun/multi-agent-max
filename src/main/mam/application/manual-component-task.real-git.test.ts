import { test, expect, vi } from 'vitest'
import { mkdtemp } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createAttemptExecutionAcceptanceFixture } from './test-fixtures/attempt-execution-acceptance-fixture'
import { MamAttemptExecutionService } from './mam-attempt-execution-service'
import { AttemptResourceMaterializer } from '../profiles/attempt-resource-materializer'
import { AttemptArtifactValidator } from './attempt-artifact-validator'
import { LocalArtifactStore } from '../artifacts/local-artifact-store'
import { DiagnosticsRecorder } from '../diagnostics/diagnostics-recorder'
import { BinaryAssetStore, CreativeJobManager } from '../creative-runtime'
import { CreativeDraftStore } from '../components/creative-drafts'
import { creativeProjectScope } from '../components/creative-project-scope'
import { createComponentExecutionPort } from '../components/attempt-component-executor'
import type { DesktopCreativeServices } from '../components/desktop-creative-services'

test('saved manual output enters a real claimed Task and submitted Attempt without generation or automatic review approval', async () => {
  const root = await mkdtemp(join(tmpdir(), 'manual-task-'))
  const assets = await BinaryAssetStore.open(join(root, 'assets'))
  const jobs = await CreativeJobManager.open({
    directory: join(root, 'jobs'),
    handlers: () => ({
      validate() {},
      async run() {
        return { text: '# Result\nSaved writing' }
      }
    })
  })
  const projectId = creativeProjectScope(join(root, 'project'))
  const id = await jobs.submit({
    componentId: 'creative.image',
    componentVersion: '1.0.0',
    operation: 'image.generate',
    projectId,
    idempotencyKey: 'draft',
    inputAssets: [],
    params: {}
  })
  await vi.waitFor(() => expect(jobs.get(id).state).toBe('succeeded'))
  const draft = await new CreativeDraftStore(join(root, 'creative-drafts'), assets).create(
    projectId,
    jobs.get(id)
  )
  const f = createAttemptExecutionAcceptanceFixture({
    root,
    componentTask: true,
    configureWorkflow(definition) {
      for (const node of definition.nodes)
        if (node.type === 'component_task') {
          node.component.draft = { sha256: draft.sha256 }
          node.outputs = [
            {
              schemaVersion: '1.0.0',
              artifactType: 'artifact.patch',
              format: 'markdown',
              required: true,
              maxBytes: 10000,
              requiredSections: ['Result']
            }
          ]
        }
    }
  })
  const runtimeHandlers = vi.fn(() => {
    throw new Error('Generation forbidden')
  })
  const services = {
    assets,
    runtimeHandlers,
    registry: {
      acquireVersion: async () => ({
        manifest: {
          version: '1.0.0',
          hostApiVersion: '1.0.0',
          operations: [{ id: 'image.generate' }]
        },
        release() {}
      })
    }
  } as unknown as DesktopCreativeServices
  let finished!: () => void
  const complete = new Promise<void>((resolve) => {
    finished = resolve
  })
  try {
    const service = new MamAttemptExecutionService({
      query: f.query,
      catalog: f.catalog,
      settings: f.settings,
      executor: {
        execute: async () => {
          throw new Error('Model execution forbidden')
        }
      },
      componentExecutor: createComponentExecutionPort({ root, services: async () => services }),
      resources: new AttemptResourceMaterializer(join(root, 'resources')),
      artifacts: new AttemptArtifactValidator(new LocalArtifactStore(join(root, 'artifacts'))),
      diagnostics: new DiagnosticsRecorder(),
      workspaceRoot: join(root, 'worktrees'),
      repository: f.repository,
      now: () => '2026-07-28T23:02:00Z',
      onStateChanged: finished
    })
    await service.start({ workflowRunId: f.bundle.run.id, taskId: f.taskId })
    await complete
    const snapshot = f.query.getSnapshot().runs[0]!
    expect(snapshot.attempts[0]!.status).toBe('submitted')
    expect(runtimeHandlers).not.toHaveBeenCalled()
    const state = f.repository.rebuild(f.bundle.run.id)
    expect(state.tasks[f.taskId]!.status).toBe('in_review')
    expect(Object.values(state.reviewPanels)).toHaveLength(1)
    expect(Object.values(state.reviewTasks)[0]!.subject.attemptId).toBe(snapshot.attempts[0]!.id)
    expect(Object.keys(state.reviewAggregations)).toHaveLength(0)
    expect(JSON.stringify(f.bundle.definition)).toContain(draft.sha256)
  } finally {
    await jobs.dispose()
    f.dispose()
  }
}, 30000)
