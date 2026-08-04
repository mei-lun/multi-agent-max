import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { rmSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildAttemptResult } from '../artifacts/attempt-result-builder'
import { LocalArtifactStore } from '../artifacts/local-artifact-store'
import { DiagnosticsRecorder } from '../diagnostics/diagnostics-recorder'
import { ExecutorLocalPreflight } from '../executors/executor-local-preflight'
import type {
  StructuredExecutorInput,
  StructuredExecutorResult
} from '../executors/structured-executor-router'
import { AttemptResourceMaterializer } from '../profiles/attempt-resource-materializer'
import { AttemptArtifactValidator } from './attempt-artifact-validator'
import { MamAttemptExecutionService } from './mam-attempt-execution-service'
import { MamAttemptInspectionService } from './mam-attempt-inspection-service'
import { createAttemptExecutionAcceptanceFixture } from './test-fixtures/attempt-execution-acceptance-fixture'
import { GitCommandRetryCoordinator } from '../state-store/git-command-retry-coordinator'
import { MamUiCommandService } from './mam-ui-command-service'
import { profileContentHash } from '../profiles/profile-content-hash'
import type { EffectiveRoleConfigSnapshot } from '../../../shared/mam/domain/role'
import { MamMergeQueueExecutionService } from './mam-merge-queue-execution-service'

const fixtures: ReturnType<typeof createAttemptExecutionAcceptanceFixture>[] = []

afterEach(() => {
  for (const fixture of fixtures.splice(0)) fixture.dispose()
})

describe('MAM Attempt execution with real Git state', () => {
  it('builds the standard result from a code Task worktree instead of assistant text', async () => {
    const fixture = createAttemptExecutionAcceptanceFixture()
    fixtures.push(fixture)
    const completed = completionSignal()
    const service = executionService(
      fixture,
      sequentialIds(),
      completed.resolve,
      workspaceOnlyExecution
    )

    await service.start({ workflowRunId: fixture.bundle.run.id, taskId: fixture.taskId })
    await completed.promise

    const attempt = fixture.query.getSnapshot().runs[0]!.attempts[0]!
    expect(attempt).toMatchObject({
      status: 'submitted',
      result: {
        summary: 'MAM verified 1 workspace output artifact(s).',
        artifacts: [
          {
            contractId: 'artifact.patch',
            type: 'artifact.patch'
          }
        ]
      }
    })
  })

  it('preflights, freezes config, runs in a task worktree, validates Artifact, and submits', async () => {
    const fixture = createAttemptExecutionAcceptanceFixture()
    fixtures.push(fixture)
    let notifyCompletion!: () => void
    const completed = new Promise<void>((resolve) => {
      notifyCompletion = resolve
    })
    const ids = sequentialIds()
    const diagnostics = new DiagnosticsRecorder()
    const execute = vi.fn(fakeExecution)
    const service = new MamAttemptExecutionService({
      query: fixture.query,
      catalog: fixture.catalog,
      settings: fixture.settings,
      executor: { execute },
      resources: new AttemptResourceMaterializer(join(fixture.root, 'attempt-resources')),
      artifacts: new AttemptArtifactValidator(
        new LocalArtifactStore(join(fixture.root, 'artifacts'))
      ),
      diagnostics,
      workspaceRoot: join(fixture.root, 'worktrees'),
      repository: fixture.repository,
      preflight: successfulCodexPreflight(),
      now: () => '2026-07-28T23:02:00Z',
      createId: ids,
      onStateChanged: notifyCompletion
    })
    rmSync(join(fixture.root, 'catalog', 'roles'), { recursive: true, force: true })

    const started = await service.start({
      workflowRunId: fixture.bundle.run.id,
      taskId: fixture.taskId
    })
    expect(started.runs[0]?.attempts[0]).toMatchObject({ status: 'running' })
    expect(execute).not.toHaveBeenCalled()
    await completed
    expect(execute).toHaveBeenCalledOnce()

    const finished = fixture.query.getSnapshot().runs[0]!
    const attempt = finished.attempts[0]!
    expect(attempt.status).toBe('submitted')
    expect(attempt.result?.artifacts).toEqual([
      expect.objectContaining({ contractId: 'artifact.patch', type: 'artifact.patch' })
    ])
    expect(attempt.result?.system.submittedCommit).toMatch(/^[0-9a-f]{40,64}$/)
    expect(
      new MamAttemptInspectionService(fixture.repository).getDiff({
        workflowRunId: fixture.bundle.run.id,
        attemptId: attempt.id
      })
    ).toMatchObject({
      attemptId: attempt.id,
      diff: expect.stringContaining('+# after'),
      truncated: false
    })
    expect(
      fixture.repository.loadEffectiveConfigSnapshot(fixture.bundle.run.id, attempt.id)
    ).toMatchObject({
      attemptId: attempt.id,
      permissions: { writePaths: ['.'] }
    })
    expect(diagnostics.list().map((event) => event.kind)).toEqual(
      expect.arrayContaining(['scheduler', 'executor', 'cost'])
    )
    const projection = fixture.repository.rebuild(fixture.bundle.run.id)
    expect(projection.tasks[fixture.taskId]).toMatchObject({ status: 'in_review' })
    expect(Object.values(projection.reviewTasks)).toHaveLength(1)
    submitReviewDecision(fixture, attempt.id, 'approved', ids)
    const mergeReady = fixture.repository.rebuild(fixture.bundle.run.id)
    expect(Object.values(mergeReady.mergeQueueEntries)).toEqual([
      expect.objectContaining({
        taskId: fixture.taskId,
        attemptId: attempt.id,
        status: 'queued'
      })
    ])
    await writeFile(join(fixture.project, 'README.md'), '# target\n')
    git(fixture.project, ['add', 'README.md'])
    git(fixture.project, ['commit', '-m', 'target: conflicting README change'])
    git(fixture.project, ['push', 'origin', 'main'])
    const conflicted = new MamMergeQueueExecutionService(
      fixture.query,
      fixture.settings,
      join(fixture.root, 'integration-worktrees'),
      'scheduler.desktop',
      fixture.repository,
      () => '2026-07-28T23:06:00Z',
      sequentialCommandIds('merge')
    ).executeNext({ workflowRunId: fixture.bundle.run.id })
    const conflictTask = conflicted.runs[0]!.mergeConflictTasks[0]!
    expect(conflicted.runs[0]?.mergeQueueEntries[0]).toMatchObject({
      status: 'conflict',
      conflictTaskId: conflictTask.id
    })
    new MamUiCommandService(
      fixture.query,
      { userId: 'user.owner', schedulerId: 'scheduler.desktop', createId: ids },
      fixture.repository
    ).assignTask({
      workflowRunId: fixture.bundle.run.id,
      taskId: conflictTask.id,
      roleProfileId: fixture.reviewerRole.id,
      roleProfileVersion: fixture.reviewerRole.version
    })
    const conflictCompletion = completionSignal()
    await executionService(fixture, ids, conflictCompletion.resolve, fakeConflictExecution).start({
      workflowRunId: fixture.bundle.run.id,
      taskId: conflictTask.id
    })
    await conflictCompletion.promise
    const resolved = fixture.repository.rebuild(fixture.bundle.run.id)
    expect(resolved.mergeQueueEntries[Object.keys(resolved.mergeQueueEntries)[0]!]).toMatchObject({
      status: 'merged',
      resolutionAttemptId: expect.any(String),
      mergeCommit: expect.any(String)
    })
  })

  it('aggregates Review changes and starts a replacement Attempt with immutable lineage', async () => {
    const fixture = createAttemptExecutionAcceptanceFixture()
    fixtures.push(fixture)
    const ids = sequentialIds()
    const firstCompletion = completionSignal()
    await executionService(fixture, ids, firstCompletion.resolve).start({
      workflowRunId: fixture.bundle.run.id,
      taskId: fixture.taskId
    })
    await firstCompletion.promise
    const firstProjection = fixture.repository.rebuild(fixture.bundle.run.id)
    const firstAttemptId = firstProjection.tasks[fixture.taskId]!.knownAttemptIds.at(-1)!
    submitReviewDecision(fixture, firstAttemptId, 'changes_requested', ids)
    expect(fixture.repository.rebuild(fixture.bundle.run.id).tasks[fixture.taskId]).toMatchObject({
      status: 'changes_requested'
    })

    const secondCompletion = completionSignal()
    await executionService(fixture, ids, secondCompletion.resolve).start({
      workflowRunId: fixture.bundle.run.id,
      taskId: fixture.taskId
    })
    await secondCompletion.promise
    const replacement = fixture.repository.rebuild(fixture.bundle.run.id)
    const secondAttemptId = replacement.tasks[fixture.taskId]!.knownAttemptIds.at(-1)!
    expect(secondAttemptId).not.toBe(firstAttemptId)
    expect(replacement.attempts[secondAttemptId]).toMatchObject({
      previousAttemptId: firstAttemptId,
      status: 'submitted'
    })
    expect(replacement.tasks[fixture.taskId]).toMatchObject({ status: 'in_review' })
    expect(Object.values(replacement.reviewPanels)).toHaveLength(2)
  })

  it('records an interrupted Executor, confirms reconciliation, and consumes the planned Attempt', async () => {
    const fixture = createAttemptExecutionAcceptanceFixture()
    fixtures.push(fixture)
    const ids = sequentialIds()
    const interrupted = completionSignal()
    const started = await executionService(fixture, ids, interrupted.resolve, async () => {
      throw new Error('executor stopped with api_key=do-not-persist')
    }).start({ workflowRunId: fixture.bundle.run.id, taskId: fixture.taskId })
    const interruptedAttemptId = started.runs[0]!.attempts[0]!.id
    await interrupted.promise

    const needsAttention = fixture.repository.rebuild(fixture.bundle.run.id)
    expect(needsAttention.tasks[fixture.taskId]).toMatchObject({
      status: 'needs_attention',
      activeAttemptIds: []
    })
    expect(needsAttention.attempts[interruptedAttemptId]?.status).toBe('needs_reconciliation')
    expect(
      JSON.stringify(fixture.repository.events.listEvents(fixture.bundle.run.id))
    ).not.toContain('do-not-persist')

    const commands = new MamUiCommandService(
      fixture.query,
      {
        userId: 'user.owner',
        schedulerId: 'scheduler.desktop',
        now: () => '2026-07-28T23:06:00Z',
        createId: ids
      },
      fixture.repository
    )
    const recovered = commands.recoverAttempt({
      workflowRunId: fixture.bundle.run.id,
      taskId: fixture.taskId,
      previousAttemptId: interruptedAttemptId,
      resolution: 'start_new_attempt',
      reason: 'Checked the retained worktree and confirmed that replay is safe.'
    })
    const plannedAttempt = recovered.runs[0]!.attempts.find(
      (attempt) => attempt.status === 'recovery_planned'
    )!
    commands.reassignTask({
      workflowRunId: fixture.bundle.run.id,
      taskId: fixture.taskId,
      previousRoleProfileId: 'role.builder',
      previousRoleProfileVersion: 1,
      roleProfileId: fixture.reviewerRole.id,
      roleProfileVersion: fixture.reviewerRole.version
    })

    const completed = completionSignal()
    const replacementStarted = await executionService(fixture, ids, completed.resolve).start({
      workflowRunId: fixture.bundle.run.id,
      taskId: fixture.taskId
    })
    expect(replacementStarted.runs[0]!.attempts).toHaveLength(2)
    expect(
      replacementStarted.runs[0]!.attempts.find((attempt) => attempt.id === plannedAttempt.id)
    ).toMatchObject({
      previousAttemptId: interruptedAttemptId,
      status: 'running'
    })
    await completed.promise

    const replacement = fixture.repository.rebuild(fixture.bundle.run.id)
    expect(replacement.attempts[plannedAttempt.id]).toMatchObject({
      previousAttemptId: interruptedAttemptId,
      status: 'submitted'
    })
    expect(replacement.tasks[fixture.taskId]).toMatchObject({
      roleProfileId: fixture.reviewerRole.id,
      roleProfileVersion: fixture.reviewerRole.version
    })
  })

  it('keeps an assigned Task retryable when local Executor preflight fails', async () => {
    const fixture = createAttemptExecutionAcceptanceFixture()
    fixtures.push(fixture)
    const service = new MamAttemptExecutionService({
      query: fixture.query,
      catalog: fixture.catalog,
      settings: fixture.settings,
      executor: { execute: fakeExecution },
      resources: new AttemptResourceMaterializer(join(fixture.root, 'attempt-resources')),
      artifacts: new AttemptArtifactValidator(
        new LocalArtifactStore(join(fixture.root, 'artifacts'))
      ),
      diagnostics: new DiagnosticsRecorder(),
      workspaceRoot: join(fixture.root, 'worktrees'),
      repository: fixture.repository,
      preflight: new ExecutorLocalPreflight(() => ({
        exitCode: null,
        stdout: '',
        stderr: 'spawn codex ENOENT'
      }))
    })

    await expect(
      service.start({ workflowRunId: fixture.bundle.run.id, taskId: fixture.taskId })
    ).rejects.toThrow('spawn codex ENOENT')
    const projection = fixture.repository.rebuild(fixture.bundle.run.id)
    expect(projection.tasks[fixture.taskId]).toMatchObject({ status: 'ready' })
    expect(projection.attempts).toEqual({})
  })

  it('rejects deferred Executors before creating an Attempt', async () => {
    const fixture = createAttemptExecutionAcceptanceFixture()
    fixtures.push(fixture)
    const service = new MamAttemptExecutionService({
      query: fixture.query,
      catalog: fixture.catalog,
      settings: fixture.settings,
      executor: { execute: fakeExecution },
      resources: new AttemptResourceMaterializer(join(fixture.root, 'attempt-resources')),
      artifacts: new AttemptArtifactValidator(
        new LocalArtifactStore(join(fixture.root, 'artifacts'))
      ),
      diagnostics: new DiagnosticsRecorder(),
      workspaceRoot: join(fixture.root, 'worktrees'),
      repository: fixture.repository,
      enabledExecutorKinds: ['pi-rpc']
    })

    await expect(
      service.start({ workflowRunId: fixture.bundle.run.id, taskId: fixture.taskId })
    ).rejects.toThrow('executor_not_enabled:codex-cli')
    expect(fixture.repository.rebuild(fixture.bundle.run.id).attempts).toEqual({})
  })
})

async function fakeExecution(input: Parameters<MamAttemptExecutionServiceExecutor['execute']>[0]) {
  const patch =
    'diff --git a/README.md b/README.md\n--- a/README.md\n+++ b/README.md\n@@ -1 +1 @@\n-# before\n+# after\n'
  const artifactPath = join(input.workspacePath, '.mam-artifacts', 'change.diff')
  await mkdir(dirname(artifactPath), { recursive: true })
  await Promise.all([
    writeFile(join(input.workspacePath, 'README.md'), '# after\n'),
    writeFile(artifactPath, patch)
  ])
  return {
    invocation: {},
    events: [],
    usage: { status: 'known' as const, inputTokens: 10, outputTokens: 20, costUsd: 0.01 },
    result: buildAttemptResult(
      {
        schemaVersion: '1.0.0',
        status: 'submitted',
        summary: 'Updated README.',
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
        usage: { status: 'known', inputTokens: 10, outputTokens: 20, costUsd: 0.01 }
      },
      input.authority
    ),
    stderr: ''
  }
}

async function workspaceOnlyExecution(
  input: Parameters<MamAttemptExecutionServiceExecutor['execute']>[0]
) {
  await writeFile(join(input.workspacePath, 'README.md'), '# after\n')
  return {
    invocation: {},
    events: [],
    usage: { status: 'known' as const, inputTokens: 10, outputTokens: 20, costUsd: 0.01 },
    stderr: ''
  }
}

async function fakeConflictExecution(
  input: Parameters<MamAttemptExecutionServiceExecutor['execute']>[0]
) {
  await writeFile(join(input.workspacePath, 'README.md'), '# resolved\n')
  return {
    invocation: {},
    events: [],
    usage: { status: 'known' as const, inputTokens: 5, outputTokens: 8, costUsd: 0.01 },
    result: buildAttemptResult(
      {
        schemaVersion: '1.0.0',
        status: 'submitted',
        summary: 'Resolved the pinned README conflict.',
        verifications: [],
        risks: [],
        followUps: [],
        artifacts: [],
        usage: { status: 'known', inputTokens: 5, outputTokens: 8, costUsd: 0.01 }
      },
      input.authority
    ),
    stderr: ''
  }
}

type MamAttemptExecutionServiceExecutor = Readonly<{
  execute(input: StructuredExecutorInput): Promise<StructuredExecutorResult>
}>

function successfulCodexPreflight(): ExecutorLocalPreflight {
  return new ExecutorLocalPreflight((_path, args) => ({
    exitCode: 0,
    stdout:
      args[0] === '--version'
        ? 'codex 1.0.0'
        : '--json --output-schema --ignore-user-config --ephemeral --model -c, --config',
    stderr: ''
  }))
}

function executionService(
  fixture: ReturnType<typeof createAttemptExecutionAcceptanceFixture>,
  createId: (kind: string) => string,
  onStateChanged: () => void,
  execute: MamAttemptExecutionServiceExecutor['execute'] = fakeExecution
): MamAttemptExecutionService {
  return new MamAttemptExecutionService({
    query: fixture.query,
    catalog: fixture.catalog,
    settings: fixture.settings,
    executor: { execute },
    resources: new AttemptResourceMaterializer(join(fixture.root, 'attempt-resources')),
    artifacts: new AttemptArtifactValidator(
      new LocalArtifactStore(join(fixture.root, 'artifacts'))
    ),
    diagnostics: new DiagnosticsRecorder(),
    workspaceRoot: join(fixture.root, 'worktrees'),
    repository: fixture.repository,
    preflight: successfulCodexPreflight(),
    now: () => '2026-07-28T23:05:00Z',
    createId,
    onStateChanged
  })
}

function completionSignal() {
  let resolve!: () => void
  const promise = new Promise<void>((complete) => {
    resolve = complete
  })
  return { promise, resolve }
}

function submitReviewDecision(
  fixture: ReturnType<typeof createAttemptExecutionAcceptanceFixture>,
  targetAttemptId: string,
  status: 'approved' | 'changes_requested',
  createId: (kind: string) => string
): void {
  const projection = fixture.repository.rebuild(fixture.bundle.run.id)
  const reviewTaskId = Object.values(projection.reviewTasks).find(
    (task) => task.subject.attemptId === targetAttemptId
  )!.id
  const coordinator = new GitCommandRetryCoordinator(fixture.repository)
  coordinator.executeAndPush({
    command: {
      schemaVersion: '1.0.0',
      commandId: 'command.assign-reviewer',
      issuedAt: '2026-07-28T23:03:00Z',
      workflowRunId: fixture.bundle.run.id,
      taskId: reviewTaskId,
      actor: { kind: 'user', userId: 'user.owner' },
      type: 'assign_task',
      roleProfileId: fixture.reviewerRole.id,
      roleProfileVersion: fixture.reviewerRole.version
    },
    schedulerId: 'scheduler.desktop'
  })
  const builderSnapshot = fixture.repository.loadEffectiveConfigSnapshot(
    fixture.bundle.run.id,
    targetAttemptId
  )!
  const { contentHash: _contentHash, ...builderConfig } = builderSnapshot
  const reviewerConfig = {
    ...builderConfig,
    id: 'effective.reviewer',
    taskId: reviewTaskId,
    attemptId: 'attempt.reviewer',
    roleProfile: {
      id: fixture.reviewerRole.id,
      version: fixture.reviewerRole.version,
      contentHash: profileContentHash(fixture.reviewerRole)
    },
    createdAt: '2026-07-28T23:03:02Z'
  }
  startReviewerAttempt(coordinator, fixture.bundle.run.id, reviewTaskId, {
    ...reviewerConfig,
    contentHash: profileContentHash(reviewerConfig)
  })
  new MamUiCommandService(
    fixture.query,
    {
      userId: 'user.owner',
      schedulerId: 'scheduler.desktop',
      now: () => '2026-07-28T23:04:00Z',
      createId
    },
    fixture.repository
  ).submitReview({
    workflowRunId: fixture.bundle.run.id,
    reviewerTaskId: reviewTaskId,
    reviewerAttemptId: 'attempt.reviewer',
    status,
    summary: status === 'approved' ? 'Ready to merge.' : 'README needs one revision.',
    findings:
      status === 'approved'
        ? []
        : [
            {
              severity: 'medium',
              category: 'content',
              summary: 'Clarify the heading.',
              filePath: 'README.md',
              line: 1
            }
          ]
  })
}

function startReviewerAttempt(
  coordinator: GitCommandRetryCoordinator,
  workflowRunId: string,
  taskId: string,
  effectiveConfigSnapshot: EffectiveRoleConfigSnapshot
): void {
  coordinator.executeAndPush({
    command: {
      schemaVersion: '1.0.0',
      commandId: 'command.announce-reviewer',
      issuedAt: '2026-07-28T23:03:01Z',
      workflowRunId,
      taskId,
      actor: { kind: 'scheduler', schedulerId: 'scheduler.desktop' },
      type: 'announce_execution',
      claimId: 'claim.reviewer',
      attemptId: 'attempt.reviewer',
      executorInstanceId: 'executor.reviewer'
    },
    schedulerId: 'scheduler.desktop'
  })
  coordinator.executeAndPush({
    command: {
      schemaVersion: '1.0.0',
      commandId: 'command.start-reviewer',
      issuedAt: '2026-07-28T23:03:02Z',
      workflowRunId,
      taskId,
      actor: { kind: 'scheduler', schedulerId: 'scheduler.desktop' },
      type: 'start_attempt',
      attemptId: 'attempt.reviewer',
      roleInstanceId: 'role-instance.reviewer',
      executorInvocationId: 'executor-invocation.reviewer',
      effectiveConfigSnapshotId: 'effective.reviewer',
      effectiveConfigHash: effectiveConfigSnapshot.contentHash
    },
    schedulerId: 'scheduler.desktop',
    effectiveConfigSnapshot
  })
}

function sequentialIds(): (kind: string) => string {
  const counts = new Map<string, number>()
  return (kind) => {
    const next = (counts.get(kind) ?? 0) + 1
    counts.set(kind, next)
    return `${kind}.${String(next)}`
  }
}

function sequentialCommandIds(scope: string): () => string {
  let count = 0
  return () => `command.${scope}.${String((count += 1))}`
}

function git(directory: string, args: readonly string[]): string {
  return execFileSync('git', ['-c', 'maintenance.auto=false', ...args], {
    cwd: directory,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  }).trim()
}
