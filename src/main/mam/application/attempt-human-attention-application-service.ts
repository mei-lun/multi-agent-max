import { z } from 'zod'
import { HumanQuestionBatchSchema } from '../../../shared/mam/domain/human-attention'
import { MamEntityIdSchema } from '../../../shared/mam/domain/primitives'
import type { SchedulerCommand } from '../../../shared/mam/scheduler-protocol'
import type { GitStateRepository } from '../state-store/git-state-repository'
import { GitCommandRetryCoordinator } from '../state-store/git-command-retry-coordinator'

const RequestHumanInputSchema = z
  .object({
    interactionId: MamEntityIdSchema,
    scope: z.enum(['task', 'branch', 'run']),
    kind: z.enum(['role_questions', 'revision_consultation']),
    batch: HumanQuestionBatchSchema
  })
  .strict()

const SubmitUnderstandingSchema = z
  .object({
    interactionId: MamEntityIdSchema,
    summary: z.string().trim().min(1).max(20_000)
  })
  .strict()

export type AttemptHumanAttentionApplicationApi = Readonly<{
  requestHumanInput(input: unknown): Promise<unknown>
  submitHumanUnderstanding(input: unknown): Promise<unknown>
}>

export class AttemptHumanAttentionApplicationService implements AttemptHumanAttentionApplicationApi {
  private readonly commands: GitCommandRetryCoordinator

  constructor(
    private readonly repository: GitStateRepository,
    private readonly authority: Readonly<{
      workflowRunId: string
      taskId: string
      attemptId: string
      roleInstanceId: string
      executorInvocationId: string
    }>,
    private readonly schedulerId: string,
    private readonly createCommandId: () => string,
    private readonly now: () => string
  ) {
    this.commands = new GitCommandRetryCoordinator(repository)
  }

  async requestHumanInput(input: unknown): Promise<unknown> {
    const request = RequestHumanInputSchema.parse(input)
    this.publish({
      type: 'request_human_input',
      interactionId: request.interactionId,
      scope: request.scope,
      kind: request.kind,
      batch: request.batch
    })
    const item = await this.waitFor(request.interactionId, 'agent_reviewing_answers')
    return item.answerBatches.at(-1)
  }

  async submitHumanUnderstanding(input: unknown): Promise<unknown> {
    const request = SubmitUnderstandingSchema.parse(input)
    this.publish({
      type: 'submit_human_understanding',
      interactionId: request.interactionId,
      summary: request.summary
    })
    for (;;) {
      const item = this.repository.rebuild(this.authority.workflowRunId).humanAttentionItems[
        request.interactionId
      ]
      if (!item) throw new Error('human_interaction_not_found')
      if (item.status === 'resolved') return { confirmed: true, confirmedAt: item.confirmedAt }
      if (item.status === 'agent_reviewing_answers') {
        return {
          confirmed: false,
          feedback: item.understandingRevisions.at(-1)?.feedback
        }
      }
      if (item.status === 'blocked') throw new Error('human_interaction_blocked')
      await wait(500)
    }
  }

  private publish(
    fields:
      | Readonly<{
          type: 'request_human_input'
          interactionId: string
          scope: 'task' | 'branch' | 'run'
          kind: 'role_questions' | 'revision_consultation'
          batch: z.infer<typeof HumanQuestionBatchSchema>
        }>
      | Readonly<{
          type: 'submit_human_understanding'
          interactionId: string
          summary: string
        }>
  ): void {
    const command = {
      schemaVersion: '1.0.0' as const,
      commandId: this.createCommandId(),
      issuedAt: this.now(),
      workflowRunId: this.authority.workflowRunId,
      taskId: this.authority.taskId,
      actor: {
        kind: 'executor' as const,
        roleInstanceId: this.authority.roleInstanceId,
        attemptId: this.authority.attemptId,
        executorInvocationId: this.authority.executorInvocationId
      },
      attemptId: this.authority.attemptId,
      ...fields
    } satisfies SchedulerCommand
    this.commands.executeAndPush({ command, schedulerId: this.schedulerId })
  }

  private async waitFor(interactionId: string, expected: 'agent_reviewing_answers' | 'resolved') {
    for (;;) {
      const item = this.repository.rebuild(this.authority.workflowRunId).humanAttentionItems[
        interactionId
      ]
      if (!item) throw new Error('human_interaction_not_found')
      if (item.status === expected) return item
      if (item.status === 'blocked') throw new Error('human_interaction_blocked')
      await wait(500)
    }
  }
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}
