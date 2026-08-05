import { randomUUID } from 'node:crypto'
import { MamExecuteNextMergeInputSchema } from '../../../shared/mam/application-command'
import type { MergeOutcome } from '../../../shared/mam/domain/merge-queue'
import type { MamUiSnapshot } from '../../../shared/mam/ui-projection'
import type { MamLocalSettingsStore } from '../profiles/mam-local-settings-store'
import { createGitCommandClient } from '../state-store/git-command-client'
import { GitCommandRetryCoordinator } from '../state-store/git-command-retry-coordinator'
import type { GitStateRepository } from '../state-store/git-state-repository'
import { createMergeConflictTask } from './merge-conflict-task-service'
import { IntegrationWorktreeMergeExecutor } from './integration-worktree-merge-executor'
import { MergeQueue } from './merge-queue-service'
import type { MamUiQueryService } from './mam-ui-query-service'
import { advanceDeterministicNodes } from './deterministic-node-advancement'
import { publishMergeReadinessForApprovedTasks } from './merge-readiness-publisher'

export class MamMergeQueueExecutionService {
  private repository: GitStateRepository | undefined

  constructor(
    private readonly query: MamUiQueryService,
    private readonly settings: MamLocalSettingsStore,
    private readonly integrationRoot: string,
    private readonly schedulerId = 'scheduler.desktop',
    repository?: GitStateRepository,
    private readonly now: () => string = () => new Date().toISOString(),
    private readonly createId: () => string = () => `command.${randomUUID().replaceAll('-', '')}`
  ) {
    this.repository = repository
  }

  setRepository(repository: GitStateRepository): void {
    this.repository = repository
  }

  executeNext(input: unknown): MamUiSnapshot {
    const request = MamExecuteNextMergeInputSchema.parse(input)
    const repository = this.requireRepository()
    publishMergeReadinessForApprovedTasks({
      repository,
      workflowRunId: request.workflowRunId,
      schedulerId: this.schedulerId,
      nextCommandId: this.createId,
      now: this.now
    })
    const projection = repository.rebuild(request.workflowRunId)
    const entry = MergeQueue.create(Object.values(projection.mergeQueueEntries))
      .list()
      .find((candidate) => candidate.status === 'queued')
    if (!entry) throw new Error('merge_queue_empty')
    const coordinator = new GitCommandRetryCoordinator(repository)
    const claimedAt = this.now()
    coordinator.executeAndPush({
      command: {
        ...schedulerEnvelope(request.workflowRunId, this.createId(), claimedAt, this.schedulerId),
        type: 'claim_merge_entry',
        entryId: entry.id,
        claimedAt
      },
      schedulerId: this.schedulerId
    })
    const claimed = repository.rebuild(request.workflowRunId).mergeQueueEntries[entry.id]!
    const result = new IntegrationWorktreeMergeExecutor(
      createGitCommandClient(this.settings.get().gitExecutable)
    ).execute({
      repositoryPath: repository.projectDirectory,
      integrationRoot: this.integrationRoot,
      remoteName: repository.remote,
      entry: claimed,
      validationCommands: Object.keys(claimed.validationEvidence)
    })
    const completedAt = this.now()
    coordinator.executeAndPush({
      command: {
        ...schedulerEnvelope(request.workflowRunId, this.createId(), completedAt, this.schedulerId),
        type: 'record_merge_outcome',
        entryId: claimed.id,
        outcome: mergeOutcome(repository, claimed, result, completedAt)
      },
      schedulerId: this.schedulerId
    })
    advanceDeterministicNodes({
      repository,
      workflowRunId: request.workflowRunId,
      schedulerId: this.schedulerId,
      nextCommandId: this.createId,
      now: this.now
    })
    publishMergeReadinessForApprovedTasks({
      repository,
      workflowRunId: request.workflowRunId,
      schedulerId: this.schedulerId,
      nextCommandId: this.createId,
      now: this.now
    })
    return this.query.getSnapshot()
  }

  private requireRepository(): GitStateRepository {
    if (!this.repository) throw new Error('project_not_attached')
    return this.repository
  }
}

function mergeOutcome(
  repository: GitStateRepository,
  entry: Parameters<typeof createMergeConflictTask>[0]['entry'],
  result: ReturnType<IntegrationWorktreeMergeExecutor['execute']>,
  completedAt: string
): MergeOutcome {
  if (result.status === 'merged') {
    return { status: 'merged', mergeCommit: result.mergeCommit, completedAt }
  }
  if (result.status === 'conflict') {
    const bundle = repository.loadRunBundle(entry.workflowRunId)
    if (!bundle) throw new Error('run_bundle_missing')
    return {
      status: 'conflict',
      conflictTask: createMergeConflictTask({ bundle, entry, result, createdAt: completedAt })
    }
  }
  return { status: 'failed', reason: `${result.stage}: ${result.reason}`, completedAt }
}

function schedulerEnvelope(
  workflowRunId: string,
  commandId: string,
  issuedAt: string,
  schedulerId: string
) {
  return {
    schemaVersion: '1.0.0' as const,
    commandId,
    issuedAt,
    workflowRunId,
    actor: { kind: 'scheduler' as const, schedulerId }
  }
}
