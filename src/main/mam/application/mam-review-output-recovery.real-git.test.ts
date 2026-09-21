import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LocalArtifactStore } from '../artifacts/local-artifact-store'
import { DiagnosticsRecorder } from '../diagnostics/diagnostics-recorder'
import { ExecutorLocalPreflight } from '../executors/executor-local-preflight'
import { AttemptResourceMaterializer } from '../profiles/attempt-resource-materializer'
import { AttemptArtifactValidator } from './attempt-artifact-validator'
import { LocalExecutionDraftStore } from './local-execution-draft-store'
import { MamAttemptExecutionService } from './mam-attempt-execution-service'
import { MamUiCommandService } from './mam-ui-command-service'
import { createAttemptExecutionAcceptanceFixture } from './test-fixtures/attempt-execution-acceptance-fixture'
import type { StructuredExecutorInput } from '../executors/structured-executor-router'

const fixtures: ReturnType<typeof createAttemptExecutionAcceptanceFixture>[] = []

afterEach(() => {
  for (const fixture of fixtures.splice(0)) fixture.dispose()
})

describe('MAM Review output recovery with real Git state', () => {
  it.each([
    {
      name: 'changes requested',
      finalAnswer: JSON.stringify({
        status: 'changes_requested',
        summary: '输入校验存在致命缺口。',
        findings: [
          {
            severity: 'blocker',
            category: 'validation',
            summary: '空白输入会导致非法状态。'
          }
        ]
      }),
      status: 'changes_requested',
      sourceTaskStatus: 'changes_requested',
      mergeReady: false
    },
    {
      name: 'approved',
      finalAnswer: '审核通过，交付符合要求。',
      status: 'approved',
      sourceTaskStatus: 'completed',
      mergeReady: true
    }
  ] as const)(
    'publishes a retained $name final answer with the same Attempt and no new model request',
    async ({ finalAnswer, status, sourceTaskStatus, mergeReady }) => {
      const fixture = createAttemptExecutionAcceptanceFixture({ executorKind: 'pi-rpc' })
      fixtures.push(fixture)
      const ids = sequentialIds()
      const diagnostics = new DiagnosticsRecorder()
      const buildCompleted = completionSignal()
      await service(fixture, ids, buildCompleted.resolve, buildWorkspace, diagnostics).start({
        workflowRunId: fixture.bundle.run.id,
        taskId: fixture.taskId
      })
      await buildCompleted.promise

      const reviewTask = Object.values(
        fixture.repository.rebuild(fixture.bundle.run.id).reviewTasks
      )[0]!
      new MamUiCommandService(
        fixture.query,
        { userId: 'user.owner', schedulerId: 'scheduler.desktop', createId: ids },
        fixture.repository
      ).assignTask({
        workflowRunId: fixture.bundle.run.id,
        taskId: reviewTask.id,
        roleProfileId: fixture.reviewerRole.id,
        roleProfileVersion: fixture.reviewerRole.version
      })

      const interrupted = completionSignal()
      await service(
        fixture,
        ids,
        interrupted.resolve,
        (input) => persistFinalAnswerThenFail(input, finalAnswer),
        diagnostics
      ).start({ workflowRunId: fixture.bundle.run.id, taskId: reviewTask.id })
      await interrupted.promise
      const drafts = new LocalExecutionDraftStore(join(fixture.root, 'worktrees', 'drafts'))
      const retained = drafts.listUnfinished().find((draft) => draft.taskId === reviewTask.id)!
      expect(retained.state).toBe('needs_attention')

      const execute = vi.fn(async () => {
        throw new Error('model_must_not_run')
      })
      const recovered = completionSignal()
      fixture.settings.save({
        ...fixture.settings.get(),
        automaticWorkflowRunIds: [fixture.bundle.run.id]
      })
      await service(fixture, ids, recovered.resolve, execute, diagnostics).resumeAutomaticDrafts()
      await recovered.promise

      const projection = fixture.repository.rebuild(fixture.bundle.run.id)
      expect(execute).not.toHaveBeenCalled()
      expect(projection.attempts[retained.attemptId]).toMatchObject({ status: 'submitted' })
      expect(Object.values(projection.reviews)).toEqual([
        expect.objectContaining({
          reviewerTaskId: reviewTask.id,
          reviewerAttemptId: retained.attemptId,
          status
        })
      ])
      expect(Object.values(projection.reviewAggregations)).toEqual([
        expect.objectContaining({ proposedStatus: status })
      ])
      expect(
        diagnostics.list().filter((event) => event.payload.status === 'review_aggregation_failed')
      ).toEqual([])
      expect(projection.tasks[fixture.taskId]).toMatchObject({ status: sourceTaskStatus })
      expect(Object.values(projection.mergeQueueEntries)).toEqual(
        mergeReady ? [expect.objectContaining({ taskId: fixture.taskId, status: 'queued' })] : []
      )
      expect(drafts.get(retained.id)?.state).toBe('delivered')
    }
  )
})

async function buildWorkspace(input: StructuredExecutorInput) {
  await writeFile(join(input.workspacePath, 'README.md'), '# after\n')
  return { invocation: {}, events: [], usage: { status: 'unknown' as const }, stderr: '' }
}

async function persistFinalAnswerThenFail(
  input: StructuredExecutorInput,
  finalAnswer: string
): Promise<never> {
  const directory = join(
    input.binding.configRoot,
    'invocations',
    createHash('sha256').update(input.executorInvocationId).digest('hex'),
    'sessions'
  )
  await mkdir(directory, { recursive: true })
  await writeFile(
    join(directory, 'review.jsonl'),
    `${JSON.stringify({
      type: 'message',
      message: {
        role: 'assistant',
        stopReason: 'stop',
        content: [
          responseText('Checking delivery.', 'commentary'),
          responseText(finalAnswer, 'final_answer')
        ]
      }
    })}\n`,
    'utf8'
  )
  throw new Error('local_review_parse_failed')
}

function service(
  fixture: ReturnType<typeof createAttemptExecutionAcceptanceFixture>,
  createId: (kind: string) => string,
  onStateChanged: () => void,
  execute: (input: StructuredExecutorInput) => Promise<unknown>,
  diagnostics = new DiagnosticsRecorder()
) {
  return new MamAttemptExecutionService({
    query: fixture.query,
    catalog: fixture.catalog,
    settings: fixture.settings,
    executor: { execute } as never,
    resources: new AttemptResourceMaterializer(join(fixture.root, 'attempt-resources')),
    artifacts: new AttemptArtifactValidator(
      new LocalArtifactStore(join(fixture.root, 'artifacts'))
    ),
    diagnostics,
    workspaceRoot: join(fixture.root, 'worktrees'),
    repository: fixture.repository,
    claimantInstanceId: 'claimant.recovery',
    preflight: piPreflight(),
    now: () => '2026-09-20T12:38:44.000Z',
    createId,
    onStateChanged
  })
}

function piPreflight() {
  return new ExecutorLocalPreflight((_path, args) => ({
    exitCode: 0,
    stdout: args[0] === '--version' ? 'pi-coding-agent 0.81.1' : '--mode rpc --json',
    stderr: ''
  }))
}

function completionSignal() {
  let resolve!: () => void
  const promise = new Promise<void>((complete) => (resolve = complete))
  return { promise, resolve }
}

function sequentialIds() {
  let count = 0
  return (kind: string) => `${kind}.recovery.${String((count += 1))}`
}

function responseText(text: string, phase: 'commentary' | 'final_answer') {
  return { type: 'text', text, textSignature: JSON.stringify({ version: 1, phase }) }
}
