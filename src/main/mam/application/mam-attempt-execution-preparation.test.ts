import { describe, expect, it } from 'vitest'
import type { ExecutableAttemptTask } from './mam-attempt-execution-types'
import { attemptExecutionPrompt, resolveExecutableTask } from './mam-attempt-execution-preparation'
import type { WorkflowRunBundle } from '../../../shared/mam/domain/run-bundle'
import type { WorkflowRunProjection } from '../state-store/git-state-projection'

describe('Review Attempt prompt', () => {
  it('asks legacy Markdown reviewers for an explicit verdict that MAM can normalize', () => {
    const prompt = attemptExecutionPrompt(
      {
        specification: 'Review the website.',
        reviewTask: { id: 'review-task.one' },
        outputContracts: [{ format: 'markdown' }]
      } as unknown as ExecutableAttemptTask,
      'mam/review'
    )

    expect(prompt).toContain('state exactly one explicit verdict')
    expect(prompt).toContain('MAM converts the report into its internal Review decision.')
  })

  it('requires actionable findings for structured change requests', () => {
    const prompt = attemptExecutionPrompt(
      {
        specification: 'Review the website.',
        reviewTask: { id: 'review-task.one' },
        outputContracts: [{ format: 'json-schema' }]
      } as unknown as ExecutableAttemptTask,
      'mam/review'
    )

    expect(prompt).toContain('Return exactly one JSON object')
    expect(prompt).toContain('include at least one actionable finding')
  })

  it('upgrades a frozen legacy Review report contract before execution', () => {
    const task = resolveExecutableTask(
      { taskCatalog: [] } as unknown as WorkflowRunBundle,
      {
        dynamicTasks: {},
        reviewTasks: {
          'review-task.legacy': {
            id: 'review-task.legacy',
            reviewNodeId: 'review.web',
            subject: { submittedCommit: 'abcdef1' },
            outputContracts: [
              {
                schemaVersion: '1.0.0',
                artifactType: 'artifact.review-report',
                format: 'json-schema',
                required: true,
                maxBytes: 1024,
                jsonSchema: {
                  type: 'object',
                  required: ['decision', 'criteriaResults', 'issues']
                }
              }
            ]
          }
        },
        mergeConflictTasks: {}
      } as unknown as WorkflowRunProjection,
      'review-task.legacy',
      'ready'
    )

    expect(task.outputContracts[0]).toMatchObject({
      format: 'json-schema',
      jsonSchema: { required: ['status', 'summary'] }
    })
    expect(attemptExecutionPrompt(task, 'mam/review')).not.toContain('criteriaResults')
  })
})
