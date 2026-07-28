import { describe, expect, it } from 'vitest'
import type { SchedulerCommand } from '../../../shared/mam/scheduler-protocol'
import { SchedulerKernel } from '../scheduler/kernel'
import { applyEvent } from '../state-store/git-event-application'
import {
  emptyWorkflowRunProjection,
  schedulerContextFromProjection,
  type WorkflowRunProjection
} from '../state-store/git-event-projection'
import { projectWorkflowRun, taskContextDefinition } from './workflow-run-projection'
import { dynamicPlanFixture } from './test-fixtures/dynamic-task-flow-fixture'

describe('dynamic Task Kernel flow', () => {
  it('commits a validated plan event and opens dependent Tasks without assigning them', () => {
    const fixture = dynamicPlanFixture()
    const source = submittedSourceProjection(fixture)
    const kernel = new SchedulerKernel()
    const context = schedulerContextFromProjection(source, {
      schedulerId: 'scheduler.1',
      taskId: fixture.sourceTaskId,
      taskDefinition: taskContextDefinition(fixture.bundle, source, fixture.sourceTaskId)!,
      runBundle: fixture.bundle
    })
    const batch = kernel.execute(dynamicTaskCommand(fixture), context)
    const event = batch.events[0]!
    if (event.type !== 'dynamic_tasks_created') throw new Error('expected dynamic_tasks_created')
    expect(event).toMatchObject({
      type: 'dynamic_tasks_created',
      taskId: fixture.sourceTaskId,
      attemptId: fixture.sourceAttemptId,
      dynamicTasks: [
        { planItemId: 'implementation', initialStatus: 'waiting_role_assignment' },
        { planItemId: 'verification', initialStatus: 'waiting_dependencies' }
      ]
    })

    let projection = applyEvent(source, event)
    const definitions = Object.values(projection.dynamicTasks)
    expect(Object.keys(projection.tasks)).toEqual([fixture.sourceTaskId])
    expect(
      projectWorkflowRun(fixture.bundle, projection, fixture.plan.createdAt).readyTaskIds
    ).toEqual([definitions[0]!.id])

    projection = assignDynamicTask(fixture, projection, definitions[0]!.id, 'role.developer', 2)
    expect(projection.tasks[definitions[0]!.id]).toMatchObject({
      status: 'ready',
      assignedByUserId: 'user.owner'
    })
    expect(
      projectWorkflowRun(fixture.bundle, projection, fixture.plan.createdAt).readyTaskIds
    ).toEqual([])

    projection = withTaskStatus(projection, definitions[0]!.id, 'submitted')
    expect(
      projectWorkflowRun(fixture.bundle, projection, fixture.plan.createdAt).readyTaskIds
    ).toEqual([definitions[1]!.id])
    projection = assignDynamicTask(fixture, projection, definitions[1]!.id, 'role.reviewer', 1)
    projection = withTaskStatus(projection, definitions[1]!.id, 'submitted')
    expect(projectWorkflowRun(fixture.bundle, projection, fixture.plan.createdAt).run.status).toBe(
      'completed'
    )
  })

  it('rejects unsubmitted sources, duplicate materialization and tampered plan events', () => {
    const fixture = dynamicPlanFixture()
    const kernel = new SchedulerKernel()
    const source = submittedSourceProjection(fixture)
    const command = dynamicTaskCommand(fixture)
    const context = schedulerContextFromProjection(source, {
      schedulerId: 'scheduler.1',
      taskId: fixture.sourceTaskId,
      taskDefinition: taskContextDefinition(fixture.bundle, source, fixture.sourceTaskId)!,
      runBundle: fixture.bundle
    })
    const event = kernel.execute(command, context).events[0]!
    if (event.type !== 'dynamic_tasks_created') throw new Error('expected dynamic_tasks_created')
    const applied = applyEvent(source, event)

    expect(() =>
      kernel.execute(
        { ...command, commandId: 'command.dynamic.before-submit' },
        schedulerContextFromProjection(
          {
            ...source,
            tasks: {
              ...source.tasks,
              [fixture.sourceTaskId]: {
                ...source.tasks[fixture.sourceTaskId]!,
                status: 'running'
              }
            }
          },
          {
            schedulerId: 'scheduler.1',
            taskId: fixture.sourceTaskId,
            runBundle: fixture.bundle
          }
        )
      )
    ).toThrow(expect.objectContaining({ code: 'dynamic_source_not_submitted' }))
    expect(() =>
      kernel.execute(
        { ...command, commandId: 'command.dynamic.duplicate' },
        schedulerContextFromProjection(applied, {
          schedulerId: 'scheduler.1',
          taskId: fixture.sourceTaskId,
          runBundle: fixture.bundle
        })
      )
    ).toThrow(expect.objectContaining({ code: 'dynamic_tasks_already_created' }))
    expect(() =>
      applyEvent(source, {
        ...event,
        planArtifact: { ...event.planArtifact, contentHash: 'f'.repeat(64) }
      })
    ).toThrow(expect.objectContaining({ code: 'dynamic_task_event_mismatch' }))
  })
})

function submittedSourceProjection(fixture: ReturnType<typeof dynamicPlanFixture>) {
  const empty = emptyWorkflowRunProjection(fixture.bundle.run.id)
  return {
    ...empty,
    tasks: {
      [fixture.sourceTaskId]: {
        status: 'submitted' as const,
        roleProfileId: 'role.planner',
        roleProfileVersion: 1,
        assignedByUserId: 'user.owner',
        activeAttemptIds: [],
        knownAttemptIds: [fixture.sourceAttemptId],
        reviewIds: [],
        executionWarnings: [],
        lastEventId: 'event.result.plan'
      }
    },
    attempts: {
      [fixture.sourceAttemptId]: {
        taskId: fixture.sourceTaskId,
        status: 'submitted' as const,
        roleInstanceId: 'role-instance.planner.1',
        executorInvocationId: 'invocation.planner.1',
        effectiveConfigHash: 'a'.repeat(64),
        lastEventId: 'event.result.plan'
      }
    }
  } satisfies WorkflowRunProjection
}

function dynamicTaskCommand(fixture: ReturnType<typeof dynamicPlanFixture>): SchedulerCommand {
  return {
    schemaVersion: '1.0.0',
    commandId: 'command.dynamic.create',
    issuedAt: fixture.plan.createdAt,
    workflowRunId: fixture.bundle.run.id,
    taskId: fixture.sourceTaskId,
    actor: { kind: 'scheduler', schedulerId: 'scheduler.1' },
    type: 'create_dynamic_tasks',
    attemptId: fixture.sourceAttemptId,
    plan: fixture.plan,
    planArtifact: fixture.planArtifact
  }
}

function assignDynamicTask(
  fixture: ReturnType<typeof dynamicPlanFixture>,
  projection: WorkflowRunProjection,
  taskId: string,
  roleProfileId: string,
  roleProfileVersion: number
): WorkflowRunProjection {
  const definition = taskContextDefinition(fixture.bundle, projection, taskId)
  const context = schedulerContextFromProjection(projection, {
    schedulerId: 'scheduler.1',
    taskId,
    ...(definition ? { taskDefinition: definition } : {})
  })
  const event = new SchedulerKernel().execute(
    {
      schemaVersion: '1.0.0',
      commandId: `command.assign.${taskId}`,
      issuedAt: fixture.plan.createdAt,
      workflowRunId: fixture.bundle.run.id,
      taskId,
      actor: { kind: 'user', userId: 'user.owner' },
      type: 'assign_task',
      roleProfileId,
      roleProfileVersion
    },
    context
  ).events[0]!
  return applyEvent(projection, event)
}

function withTaskStatus(
  projection: WorkflowRunProjection,
  taskId: string,
  status: 'submitted'
): WorkflowRunProjection {
  return {
    ...projection,
    tasks: {
      ...projection.tasks,
      [taskId]: { ...projection.tasks[taskId]!, status }
    }
  }
}
