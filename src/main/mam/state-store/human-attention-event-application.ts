import type { SchedulerEvent } from '../../../shared/mam/scheduler-protocol'
import type {
  HumanAttentionItem,
  HumanReviewDecision
} from '../../../shared/mam/domain/human-attention'
import type {
  AttemptProjection,
  TaskProjection,
  WorkflowRunProjection
} from './git-state-projection'
import {
  failGitEventApplication as fail,
  requireProjectedAttempt,
  requireProjectedTask,
  updateProjectedTask
} from './task-attempt-event-state'

type HumanAttentionEvent = Extract<SchedulerEvent, { type: `human_${string}` }>

const HUMAN_EVENT_TYPES = new Set<HumanAttentionEvent['type']>([
  'human_input_requested',
  'human_questions_answered',
  'human_understanding_submitted',
  'human_understanding_confirmed',
  'human_understanding_revision_requested',
  'human_review_resolved'
])

export function isHumanAttentionEvent(event: SchedulerEvent): event is HumanAttentionEvent {
  return HUMAN_EVENT_TYPES.has(event.type as HumanAttentionEvent['type'])
}

export function applyHumanAttentionProjectionEvent(
  projection: WorkflowRunProjection,
  event: HumanAttentionEvent
): WorkflowRunProjection {
  const tasks = { ...projection.tasks }
  const attempts = { ...projection.attempts }
  const items = { ...projection.humanAttentionItems }
  const reviewDecisions = { ...projection.humanReviewDecisions }
  applyHumanAttentionEvent({ event, tasks, attempts, items, reviewDecisions })
  return {
    ...projection,
    tasks,
    attempts,
    humanAttentionItems: items,
    humanReviewDecisions: reviewDecisions
  }
}

export function applyHumanAttentionEvent(input: {
  event: HumanAttentionEvent
  tasks: Record<string, TaskProjection>
  attempts: Record<string, AttemptProjection>
  items: Record<string, HumanAttentionItem>
  reviewDecisions: Record<string, HumanReviewDecision>
}): void {
  const { event, tasks, attempts, items, reviewDecisions } = input
  const task = requireProjectedTask(tasks, event.taskId)
  if (event.type === 'human_review_resolved') {
    if (reviewDecisions[event.decision.id]) fail('duplicate_human_review', 'Review already exists')
    if (task.knownAttemptIds.at(-1) !== event.decision.subject.attemptId) {
      fail('stale_human_review', 'Human review does not target the latest Attempt')
    }
    reviewDecisions[event.decision.id] = event.decision
    tasks[event.taskId] = updateProjectedTask(task, event, {
      status: event.decision.status
    })
    return
  }
  if (event.type === 'human_input_requested') {
    const attempt = requireProjectedAttempt(attempts, event.attemptId, event.taskId)
    if (attempt.status !== 'running') fail('stale_attempt', 'Attempt cannot ask the user')
    const existing = items[event.interactionId]
    if (existing) {
      if (
        existing.taskId !== event.taskId ||
        existing.attemptId !== event.attemptId ||
        existing.status !== 'agent_reviewing_answers'
      ) {
        fail('invalid_human_interaction', 'Interaction cannot accept another question batch')
      }
      if (existing.batches.some((batch) => batch.id === event.batch.id)) {
        fail('duplicate_question_batch', 'Question batch already exists')
      }
      items[event.interactionId] = {
        ...existing,
        status: 'awaiting_human_answers',
        batches: [...existing.batches, event.batch],
        updatedAt: event.createdAt
      }
    } else {
      items[event.interactionId] = {
        schemaVersion: '1.0.0',
        id: event.interactionId,
        workflowRunId: event.workflowRunId,
        taskId: event.taskId,
        attemptId: event.attemptId,
        roleProfileId: event.roleProfileId,
        roleProfileVersion: event.roleProfileVersion,
        roleInstanceId: event.roleInstanceId,
        scope: event.scope,
        kind: event.kind,
        status: 'awaiting_human_answers',
        batches: [event.batch],
        answerBatches: [],
        understandingSummaries: [],
        understandingRevisions: [],
        createdAt: event.createdAt,
        updatedAt: event.createdAt
      }
    }
    tasks[event.taskId] = updateProjectedTask(task, event, {
      status: 'waiting_for_human_input'
    })
    return
  }
  const item = items[event.interactionId]
  if (!item || item.taskId !== event.taskId) {
    fail('human_interaction_not_found', 'Human interaction is not bound to this task')
  }
  if (event.type === 'human_questions_answered') {
    if (item.status !== 'awaiting_human_answers') {
      fail('invalid_human_interaction', 'Question batch is not awaiting answers')
    }
    const batch = item.batches.at(-1)
    if (!batch || batch.id !== event.batchId)
      fail('question_batch_not_found', 'Batch is not active')
    validateAnswers(batch.questions, event.answers)
    items[item.id] = {
      ...item,
      status: 'agent_reviewing_answers',
      answerBatches: [
        ...item.answerBatches,
        {
          batchId: event.batchId,
          answers: event.answers,
          answeredByUserId: event.answeredByUserId,
          answeredAt: event.createdAt
        }
      ],
      updatedAt: event.createdAt
    }
    return
  }
  if (event.type === 'human_understanding_submitted') {
    if (item.attemptId !== event.attemptId || item.status !== 'agent_reviewing_answers') {
      fail('invalid_human_interaction', 'Interaction is not ready for an understanding summary')
    }
    items[item.id] = {
      ...item,
      status: 'ready_for_confirmation',
      understandingSummary: event.summary,
      understandingSummaries: [
        ...item.understandingSummaries,
        { summary: event.summary, submittedAt: event.createdAt }
      ],
      updatedAt: event.createdAt
    }
    return
  }
  if (event.type === 'human_understanding_revision_requested') {
    if (item.status !== 'ready_for_confirmation') {
      fail('invalid_human_interaction', 'Understanding is not ready for revision feedback')
    }
    items[item.id] = {
      ...item,
      status: 'agent_reviewing_answers',
      understandingRevisions: [
        ...item.understandingRevisions,
        {
          feedback: event.feedback,
          requestedByUserId: event.requestedByUserId,
          requestedAt: event.createdAt
        }
      ],
      updatedAt: event.createdAt
    }
    return
  }
  if (item.status !== 'ready_for_confirmation') {
    fail('invalid_human_interaction', 'Understanding is not ready for confirmation')
  }
  items[item.id] = {
    ...item,
    status: 'resolved',
    confirmedByUserId: event.confirmedByUserId,
    confirmedAt: event.createdAt,
    updatedAt: event.createdAt
  }
  tasks[event.taskId] = updateProjectedTask(task, event, { status: 'running' })
}

function validateAnswers(
  questions: readonly Readonly<{
    id: string
    kind: 'decision' | 'information'
    options: readonly Readonly<{ id: string }>[]
  }>[],
  answers: readonly Readonly<{
    questionId: string
    selectedOptionId?: string | undefined
    customAnswer?: string | undefined
  }>[]
): void {
  if (new Set(answers.map((answer) => answer.questionId)).size !== answers.length) {
    fail('duplicate_human_answer', 'Each question can be answered once')
  }
  if (answers.length !== questions.length) fail('incomplete_human_answers', 'Answer every question')
  for (const question of questions) {
    const answer = answers.find((candidate) => candidate.questionId === question.id)
    if (!answer) fail('incomplete_human_answers', `Missing answer for ${question.id}`)
    if (question.kind === 'information' && !answer.customAnswer) {
      fail('invalid_human_answer', 'Information questions require text')
    }
    if (
      answer.selectedOptionId &&
      !question.options.some((option) => option.id === answer.selectedOptionId)
    ) {
      fail('invalid_human_answer', 'Selected option is outside the question')
    }
  }
}
