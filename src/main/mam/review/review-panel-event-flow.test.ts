import { describe, expect, it } from 'vitest'
import type { ReviewSubject } from '../../../shared/mam/domain/review'
import type { SchedulerCommand } from '../../../shared/mam/scheduler-protocol'
import type { WorkflowDefinition } from '../../../shared/mam/domain/workflow'
import { createWorkflowRunBundle } from '../application/workflow-run-factory'
import { projectWorkflowRun, taskContextDefinition } from '../application/workflow-run-projection'
import { SchedulerKernel } from '../scheduler/kernel'
import { applyEvent } from '../state-store/git-event-application'
import {
  emptyWorkflowRunProjection,
  schedulerContextFromProjection,
  type WorkflowRunProjection
} from '../state-store/git-event-projection'

const hash = 'a'.repeat(64)
const subject: ReviewSubject = {
  taskId: 'task.implementation',
  attemptId: 'attempt.implementation.1',
  resultHash: 'b'.repeat(64),
  artifactHashes: ['c'.repeat(64)],
  submittedCommit: 'abcdef1'
}

describe('Review panel Scheduler event flow', () => {
  it('persists generated reviewer Tasks and exposes only manual Assignment candidates', () => {
    const bundle = reviewBundle()
    expect(bundle.taskCatalog).toEqual([])
    let projection = targetProjection(bundle.run.id)
    const context = schedulerContextFromProjection(projection, {
      schedulerId: 'scheduler.1',
      taskId: subject.taskId,
      taskDefinition: reviewTargetDefinition(subject),
      runBundle: bundle
    })
    const event = new SchedulerKernel().execute(createPanelCommand(bundle.run.id), context)
      .events[0]!
    expect(event).toMatchObject({
      type: 'review_panel_created',
      reviewNodeId: 'review',
      reviewTasks: [
        { allowedRoleProfileIds: ['role.reviewer-a'] },
        { allowedRoleProfileIds: ['role.reviewer-b'] }
      ]
    })

    projection = applyEvent(projection, event)
    const reviewTaskIds = Object.keys(projection.reviewTasks).sort()
    expect(Object.keys(projection.tasks)).toEqual([subject.taskId])
    expect(projectWorkflowRun(bundle, projection, '2026-07-28T17:05:00Z').readyTaskIds).toEqual(
      reviewTaskIds
    )
    expect(projection.tasks[subject.taskId]).toMatchObject({
      status: 'in_review',
      reviewPanelId: `review.${subject.attemptId}`
    })

    const reviewTaskId = reviewTaskIds[0]!
    const definition = taskContextDefinition(bundle, projection, reviewTaskId)!
    const assignment = new SchedulerKernel().execute(
      assignReviewTaskCommand(bundle.run.id, reviewTaskId, definition.allowedRoleProfileIds[0]!),
      schedulerContextFromProjection(projection, {
        schedulerId: 'scheduler.1',
        taskId: reviewTaskId,
        taskDefinition: definition
      })
    ).events[0]!
    projection = applyEvent(projection, assignment)
    expect(projection.tasks[reviewTaskId]).toMatchObject({
      status: 'ready',
      assignedByUserId: 'user.owner'
    })
  })

  it('rejects a panel for a different immutable subject before generating Tasks', () => {
    const bundle = reviewBundle()
    const projection = targetProjection(bundle.run.id)
    expect(() =>
      new SchedulerKernel().execute(
        {
          ...createPanelCommand(bundle.run.id),
          commandId: 'command.review-panel.foreign',
          subject: { ...subject, resultHash: 'f'.repeat(64) }
        },
        schedulerContextFromProjection(projection, {
          schedulerId: 'scheduler.1',
          taskId: subject.taskId,
          taskDefinition: reviewTargetDefinition(subject),
          runBundle: bundle
        })
      )
    ).toThrow(expect.objectContaining({ code: 'review_binding_mismatch' }))
  })
})

function targetProjection(workflowRunId: string): WorkflowRunProjection {
  return {
    ...emptyWorkflowRunProjection(workflowRunId),
    tasks: {
      [subject.taskId]: {
        status: 'submitted',
        roleProfileId: 'role.developer',
        roleProfileVersion: 1,
        assignedByUserId: 'user.owner',
        activeAttemptIds: [],
        knownAttemptIds: [subject.attemptId],
        reviewIds: [],
        executionWarnings: [],
        lastEventId: 'event.result'
      }
    },
    attempts: {
      [subject.attemptId]: {
        taskId: subject.taskId,
        status: 'submitted',
        lastEventId: 'event.result'
      }
    }
  }
}

function reviewTargetDefinition(reviewTarget: ReviewSubject) {
  return {
    initialStatus: 'waiting_role_assignment' as const,
    allowedRoleProfileIds: ['role.developer'],
    roleCatalogVersions: new Map([['role.developer', new Set([1])]]),
    reviewTarget
  }
}

function createPanelCommand(workflowRunId: string): SchedulerCommand {
  return {
    schemaVersion: '1.0.0',
    commandId: 'command.review-panel.create',
    issuedAt: '2026-07-28T17:05:00Z',
    workflowRunId,
    taskId: subject.taskId,
    actor: { kind: 'scheduler', schedulerId: 'scheduler.1' },
    type: 'create_review_panel',
    reviewNodeId: 'review',
    subject
  }
}

function assignReviewTaskCommand(
  workflowRunId: string,
  taskId: string,
  roleProfileId: string
): SchedulerCommand {
  return {
    schemaVersion: '1.0.0',
    commandId: `command.assign.${taskId}`,
    issuedAt: '2026-07-28T17:06:00Z',
    workflowRunId,
    taskId,
    actor: { kind: 'user', userId: 'user.owner' },
    type: 'assign_task',
    roleProfileId,
    roleProfileVersion: 1
  }
}

function reviewBundle() {
  return createWorkflowRunBundle({
    runId: 'run.review-panel',
    definition: reviewWorkflow(),
    roleCatalog: [
      { roleProfileId: 'role.reviewer-a', roleProfileVersion: 1, contentHash: hash },
      { roleProfileId: 'role.reviewer-b', roleProfileVersion: 1, contentHash: hash }
    ],
    inputArtifacts: [{ artifactId: 'artifact.target', version: 1, contentHash: hash }],
    createdAt: '2026-07-28T17:00:00Z'
  })
}

function reviewWorkflow(): WorkflowDefinition {
  return {
    schemaVersion: '1.0.0',
    id: 'workflow.review-panel',
    name: 'Review panel',
    version: 1,
    nodes: [
      {
        id: 'review',
        type: 'review_gate',
        recommendedRoleProfileIds: ['role.reviewer-a'],
        allowedRoleProfileIds: ['role.reviewer-a', 'role.reviewer-b'],
        inputs: [{ artifactId: 'artifact.target', version: 1, contentHash: hash }],
        reportContract: {
          schemaVersion: '1.0.0',
          artifactType: 'artifact.review',
          format: 'json-schema',
          required: true,
          maxBytes: 100_000,
          jsonSchema: { type: 'object' }
        },
        minimumDecisions: 2,
        maxRevisionAttempts: 3
      },
      { id: 'finish', type: 'finish', inputs: [] }
    ],
    edges: [{ from: 'review', to: 'finish' }],
    maxTransitions: 20,
    maxRunCostUsd: 20,
    maxRunDurationSeconds: 3600
  }
}
