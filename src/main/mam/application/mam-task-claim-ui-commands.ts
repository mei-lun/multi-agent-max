import { randomUUID } from 'node:crypto'
import { MamEntityIdSchema } from '../../../shared/mam/domain/primitives'
import type { MamUiSnapshot } from '../../../shared/mam/ui-projection'
import { GitCommandRetryCoordinator } from '../state-store/git-command-retry-coordinator'
import type { GitStateRepository } from '../state-store/git-state-repository'
import type { MamUiQueryService } from './mam-ui-query-service'
import { MamHumanAttentionUiCommands } from './mam-human-attention-ui-commands'
import { executeTaskClaimUiCommand } from './task-claim-command-service'

type ClaimUiOptions = Readonly<{
  userId: string
  schedulerId: string
  now?: () => string
  createId?: (kind: 'command' | 'claim') => string
  onStateChanged?: () => void
  claimantInstanceId?: string
}>

export abstract class MamTaskClaimUiCommands extends MamHumanAttentionUiCommands {
  private readonly claimUserId: string
  private readonly claimSchedulerId: string
  private readonly claimNow: () => string
  private readonly claimCreateId: (kind: 'command' | 'claim') => string
  private readonly claimantInstanceId: string
  private readonly claimChanged: () => void
  private claimPublisher: GitCommandRetryCoordinator | undefined

  constructor(
    private readonly claimQuery: MamUiQueryService,
    options: ClaimUiOptions
  ) {
    super()
    this.claimUserId = MamEntityIdSchema.parse(options.userId)
    this.claimSchedulerId = MamEntityIdSchema.parse(options.schedulerId)
    this.claimNow = options.now ?? (() => new Date().toISOString())
    this.claimCreateId =
      options.createId ?? ((kind) => `${kind}.${randomUUID().replaceAll('-', '')}`)
    this.claimantInstanceId =
      options.claimantInstanceId ?? `claimant.${randomUUID().replaceAll('-', '')}`
    this.claimChanged = options.onStateChanged ?? (() => undefined)
  }

  protected setTaskClaimRepository(repository: GitStateRepository): void {
    this.claimPublisher = new GitCommandRetryCoordinator(repository)
  }

  claimTask(input: unknown): MamUiSnapshot {
    return this.executeTaskClaim('claim', input)
  }

  releaseTaskClaim(input: unknown): MamUiSnapshot {
    return this.executeTaskClaim('release', input)
  }

  forceTakeoverTask(input: unknown): MamUiSnapshot {
    return this.executeTaskClaim('takeover', input)
  }

  private executeTaskClaim(
    action: 'claim' | 'release' | 'takeover',
    request: unknown
  ): MamUiSnapshot {
    if (!this.claimPublisher) throw new Error('state_repository_unavailable')
    return executeTaskClaimUiCommand({
      action,
      request,
      userId: this.claimUserId,
      schedulerId: this.claimSchedulerId,
      claimantInstanceId: this.claimantInstanceId,
      nextId: (kind) => MamEntityIdSchema.parse(this.claimCreateId(kind)),
      issuedAt: this.claimNow(),
      publisher: this.claimPublisher,
      onStateChanged: this.claimChanged,
      getSnapshot: () => this.claimQuery.getSnapshot()
    })
  }
}
