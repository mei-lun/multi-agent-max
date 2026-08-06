import { describe, expect, it } from 'vitest'
import { SchedulerEventSchema, type SchedulerEvent } from '../../../shared/mam/scheduler-protocol'
import { emptyWorkflowRunProjection } from './empty-workflow-run-projection'
import { applyEvent } from './git-event-application'

const timestamp = '2026-08-06T00:00:00.000Z'
const revision = '0'.repeat(64)

describe('Human attention event application', () => {
  it('pauses a Task, records batch answers and resumes only after confirmed understanding', () => {
    let projection = emptyWorkflowRunProjection('run.human')
    for (const event of lifecycleEvents()) projection = applyEvent(projection, event)
    projection = applyEvent(
      projection,
      humanEvent('human_input_requested', {
        taskId: 'task.human',
        attemptId: 'attempt.human',
        interactionId: 'interaction.human',
        roleProfileId: 'role.human',
        roleProfileVersion: 1,
        roleInstanceId: 'role-instance.human',
        executorInvocationId: 'executor-invocation.human',
        scope: 'branch',
        kind: 'role_questions',
        batch: questionBatch()
      })
    )
    expect(projection.tasks['task.human']?.status).toBe('waiting_for_human_input')
    expect(projection.humanAttentionItems['interaction.human']?.status).toBe(
      'awaiting_human_answers'
    )
    projection = applyEvent(
      projection,
      humanEvent('human_questions_answered', {
        taskId: 'task.human',
        interactionId: 'interaction.human',
        batchId: 'batch.human',
        answers: [{ questionId: 'question.human', selectedOptionId: 'option.recommended' }],
        answeredByUserId: 'user.human'
      })
    )
    expect(projection.humanAttentionItems['interaction.human']?.status).toBe(
      'agent_reviewing_answers'
    )
    projection = applyEvent(
      projection,
      humanEvent('human_understanding_submitted', {
        taskId: 'task.human',
        attemptId: 'attempt.human',
        interactionId: 'interaction.human',
        summary: 'Use the recommended recoverable behavior.',
        roleInstanceId: 'role-instance.human',
        executorInvocationId: 'executor-invocation.human'
      })
    )
    expect(projection.tasks['task.human']?.status).toBe('waiting_for_human_input')
    projection = applyEvent(
      projection,
      humanEvent('human_understanding_revision_requested', {
        taskId: 'task.human',
        interactionId: 'interaction.human',
        feedback: 'Clarify that existing data must remain recoverable.',
        requestedByUserId: 'user.human'
      })
    )
    expect(projection.humanAttentionItems['interaction.human']?.status).toBe(
      'agent_reviewing_answers'
    )
    projection = applyEvent(
      projection,
      humanEvent('human_understanding_submitted', {
        eventId: 'event.human_understanding_submitted.2',
        commandId: 'command.human_understanding_submitted.2',
        taskId: 'task.human',
        attemptId: 'attempt.human',
        interactionId: 'interaction.human',
        summary: 'Use recoverable behavior and preserve all existing data.',
        roleInstanceId: 'role-instance.human',
        executorInvocationId: 'executor-invocation.human'
      })
    )
    projection = applyEvent(
      projection,
      humanEvent('human_understanding_confirmed', {
        taskId: 'task.human',
        interactionId: 'interaction.human',
        confirmedByUserId: 'user.human'
      })
    )
    expect(projection.tasks['task.human']?.status).toBe('running')
    expect(projection.humanAttentionItems['interaction.human']?.status).toBe('resolved')
    expect(
      projection.humanAttentionItems['interaction.human']?.understandingSummaries
    ).toHaveLength(2)
    expect(
      projection.humanAttentionItems['interaction.human']?.understandingRevisions
    ).toHaveLength(1)
  })
})

function lifecycleEvents(): SchedulerEvent[] {
  return [
    humanEvent('task_assigned', {
      taskId: 'task.human',
      roleProfileId: 'role.human',
      roleProfileVersion: 1,
      assignedByUserId: 'user.human'
    }),
    humanEvent('execution_announced', {
      taskId: 'task.human',
      claimId: 'claim.human',
      attemptId: 'attempt.human',
      executorInstanceId: 'executor.human',
      concurrentAttemptIds: []
    }),
    humanEvent('attempt_started', {
      taskId: 'task.human',
      attemptId: 'attempt.human',
      roleInstanceId: 'role-instance.human',
      executorInvocationId: 'executor-invocation.human',
      effectiveConfigSnapshotId: 'config.human',
      effectiveConfigHash: '1'.repeat(64)
    })
  ]
}

function questionBatch() {
  return {
    id: 'batch.human',
    title: 'Choose deletion behavior',
    summary: 'Storage behavior is unclear.',
    questions: [
      {
        id: 'question.human',
        kind: 'decision' as const,
        question: 'Which behavior should be used?',
        whyItMatters: 'It changes recovery behavior.',
        options: [
          { id: 'option.recommended', label: 'Soft', description: 'Recoverable.' },
          { id: 'option.other', label: 'Hard', description: 'Permanent.' }
        ],
        recommendedOptionId: 'option.recommended',
        recommendationReason: 'It is safer.'
      }
    ]
  }
}

function humanEvent(type: SchedulerEvent['type'], fields: Record<string, unknown>): SchedulerEvent {
  return SchedulerEventSchema.parse({
    schemaVersion: '1.0.0',
    eventId: `event.${type}`,
    commandId: `command.${type}`,
    createdAt: timestamp,
    workflowRunId: 'run.human',
    schedulerId: 'scheduler.human',
    parentRevision: revision,
    type,
    ...fields
  })
}
