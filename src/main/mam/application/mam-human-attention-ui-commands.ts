import {
  MamAnswerHumanQuestionsInputSchema,
  MamConfirmHumanUnderstandingInputSchema,
  MamResolveHumanReviewInputSchema,
  MamReviseHumanUnderstandingInputSchema
} from '../../../shared/mam/application-command'
import type { SchedulerCommand } from '../../../shared/mam/scheduler-protocol'
import type { MamUiSnapshot } from '../../../shared/mam/ui-projection'
import type { CommandPublisher } from './approval-gate-delivery-command'

type HumanUserCommand = Extract<
  SchedulerCommand,
  {
    type:
      | 'answer_human_questions'
      | 'confirm_human_understanding'
      | 'revise_human_understanding'
      | 'resolve_human_review'
  }
>

export type HumanAttentionUiCommandContext = Readonly<{
  commands: CommandPublisher
  schedulerId: string
  userId: string
  nextCommandId(): string
  now(): string
  onStateChanged(): void
  getSnapshot(): MamUiSnapshot
}>

export abstract class MamHumanAttentionUiCommands {
  protected abstract humanAttentionCommandContext(): HumanAttentionUiCommandContext

  answerHumanQuestions(input: unknown): MamUiSnapshot {
    const parsed = MamAnswerHumanQuestionsInputSchema.parse(input)
    return this.publishHumanCommand({
      ...envelope(parsed, this.humanAttentionCommandContext()),
      type: 'answer_human_questions',
      interactionId: parsed.interactionId,
      batchId: parsed.batchId,
      answers: parsed.answers
    })
  }

  confirmHumanUnderstanding(input: unknown): MamUiSnapshot {
    const parsed = MamConfirmHumanUnderstandingInputSchema.parse(input)
    return this.publishHumanCommand({
      ...envelope(parsed, this.humanAttentionCommandContext()),
      type: 'confirm_human_understanding',
      interactionId: parsed.interactionId
    })
  }

  reviseHumanUnderstanding(input: unknown): MamUiSnapshot {
    const parsed = MamReviseHumanUnderstandingInputSchema.parse(input)
    return this.publishHumanCommand({
      ...envelope(parsed, this.humanAttentionCommandContext()),
      type: 'revise_human_understanding',
      interactionId: parsed.interactionId,
      feedback: parsed.feedback
    })
  }

  resolveHumanReview(input: unknown): MamUiSnapshot {
    const parsed = MamResolveHumanReviewInputSchema.parse(input)
    return this.publishHumanCommand({
      ...envelope(parsed, this.humanAttentionCommandContext()),
      type: 'resolve_human_review',
      gateNodeId: parsed.gateNodeId,
      subject: parsed.subject,
      status: parsed.status,
      ...(parsed.feedback ? { feedback: parsed.feedback } : {})
    })
  }

  private publishHumanCommand(command: HumanUserCommand): MamUiSnapshot {
    const context = this.humanAttentionCommandContext()
    context.commands.executeAndPush({ command, schedulerId: context.schedulerId })
    context.onStateChanged()
    return context.getSnapshot()
  }
}

function envelope(
  input: Readonly<{ workflowRunId: string; taskId: string }>,
  context: HumanAttentionUiCommandContext
) {
  return {
    schemaVersion: '1.0.0' as const,
    commandId: context.nextCommandId(),
    issuedAt: context.now(),
    workflowRunId: input.workflowRunId,
    taskId: input.taskId,
    actor: { kind: 'user' as const, userId: context.userId }
  }
}
