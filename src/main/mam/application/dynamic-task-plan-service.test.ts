import { describe, expect, it } from 'vitest'
import { materializeDynamicTaskPlan } from './dynamic-task-plan-service'
import { dynamicPlanFixture } from './test-fixtures/dynamic-task-flow-fixture'

describe('dynamic Task Plan service', () => {
  it('creates deterministic unassigned Tasks with Attempt and plan lineage', () => {
    const fixture = dynamicPlanFixture()
    const first = materializeDynamicTaskPlan(fixture)
    const second = materializeDynamicTaskPlan(fixture)

    expect(second).toEqual(first)
    expect(first).toHaveLength(2)
    expect(first[0]).toMatchObject({
      parentTaskId: fixture.sourceTaskId,
      sourceAttemptId: fixture.sourceAttemptId,
      taskPlanId: fixture.plan.id,
      taskPlanHash: fixture.planArtifact.contentHash,
      planItemId: 'implementation',
      initialStatus: 'waiting_role_assignment',
      recommendedRoleProfileIds: ['role.developer'],
      allowedRoleProfileIds: ['role.developer']
    })
    expect(first[1]).toMatchObject({
      planItemId: 'verification',
      initialStatus: 'waiting_dependencies',
      dependencies: [first[0]!.id]
    })
    expect(first.every((task) => !('assignment' in task))).toBe(true)
  })

  it('rejects excess tasks, malformed dependency graphs and roles outside the frozen Run', () => {
    const fixture = dynamicPlanFixture()
    const extra = {
      ...fixture.plan.tasks[0]!,
      id: 'third',
      dependencies: []
    }
    expect(() =>
      materializeDynamicTaskPlan({
        ...fixture,
        plan: { ...fixture.plan, tasks: [...fixture.plan.tasks, extra] }
      })
    ).toThrow(expect.objectContaining({ code: 'dynamic_task_limit_exceeded' }))
    expect(() =>
      materializeDynamicTaskPlan({
        ...fixture,
        plan: {
          ...fixture.plan,
          tasks: [
            { ...fixture.plan.tasks[0]!, dependencies: ['verification'] },
            { ...fixture.plan.tasks[1]!, dependencies: ['implementation'] }
          ]
        }
      })
    ).toThrow(expect.objectContaining({ code: 'dynamic_task_cycle' }))
    expect(() =>
      materializeDynamicTaskPlan({
        ...fixture,
        plan: {
          ...fixture.plan,
          tasks: [
            {
              ...fixture.plan.tasks[0]!,
              recommendedRoleProfileIds: ['role.foreign'],
              allowedRoleProfileIds: ['role.foreign']
            },
            fixture.plan.tasks[1]!
          ]
        }
      })
    ).toThrow(expect.objectContaining({ code: 'dynamic_role_not_in_run_catalog' }))
  })

  it('requires a valid Git Artifact bound to the source Attempt and exact plan hash', () => {
    const fixture = dynamicPlanFixture()
    expect(() =>
      materializeDynamicTaskPlan({
        ...fixture,
        planArtifact: { ...fixture.planArtifact, availability: 'local' }
      })
    ).toThrow(expect.objectContaining({ code: 'task_plan_artifact_not_git' }))
    expect(() =>
      materializeDynamicTaskPlan({
        ...fixture,
        planArtifact: { ...fixture.planArtifact, attemptId: 'attempt.other' }
      })
    ).toThrow(expect.objectContaining({ code: 'task_plan_artifact_binding_mismatch' }))
    expect(() =>
      materializeDynamicTaskPlan({
        ...fixture,
        planArtifact: { ...fixture.planArtifact, contentHash: 'f'.repeat(64) }
      })
    ).toThrow(expect.objectContaining({ code: 'task_plan_hash_mismatch' }))
    expect(() =>
      materializeDynamicTaskPlan({
        ...fixture,
        plan: { ...fixture.plan, sourceAttemptId: 'attempt.other' }
      })
    ).toThrow(expect.objectContaining({ code: 'task_plan_binding_mismatch' }))
  })

  it('rejects a deterministic Task ID already present in the Run', () => {
    const fixture = dynamicPlanFixture()
    const generated = materializeDynamicTaskPlan(fixture)
    expect(() =>
      materializeDynamicTaskPlan({
        ...fixture,
        existingTaskIds: new Set([generated[0]!.id])
      })
    ).toThrow(expect.objectContaining({ code: 'dynamic_task_id_collision' }))
  })
})
