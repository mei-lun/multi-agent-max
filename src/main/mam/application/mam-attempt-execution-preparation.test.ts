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

  it('includes the reviewed Artifact source in a Review prompt', () => {
    const task = resolveExecutableTask(
      {
        definition: {
          nodes: [
            { id: 'author', type: 'role_task' },
            { id: 'review.web', type: 'review_gate' }
          ],
          edges: [{ from: 'author', to: 'review.web' }]
        },
        taskCatalog: [
          {
            id: 'task.author',
            nodeId: 'author',
            outputContracts: [{ artifactType: 'artifact.delivery', format: 'markdown' }]
          }
        ]
      } as unknown as WorkflowRunBundle,
      {
        tasks: {
          'task.author': {
            knownAttemptIds: ['attempt.author'],
            selectedAttemptId: 'attempt.author'
          }
        },
        attempts: {
          'attempt.author': {
            status: 'submitted',
            result: {
              artifacts: [
                {
                  type: 'artifact.delivery',
                  contentRef: 'workspace:docs/delivery.md',
                  sha256: 'b'.repeat(64)
                }
              ],
              system: { submittedCommit: 'a'.repeat(40) }
            }
          }
        },
        dynamicTasks: {},
        reviewTasks: {
          'review-task.one': {
            id: 'review-task.one',
            reviewNodeId: 'review.web',
            subject: { submittedCommit: 'a'.repeat(40) },
            inputArtifacts: [
              {
                artifactId: 'artifact.delivery',
                version: 1,
                contentHash: '0'.repeat(64)
              }
            ],
            outputContracts: [
              {
                schemaVersion: '1.0.0',
                artifactType: 'artifact.review',
                format: 'markdown',
                required: true,
                maxBytes: 10_000,
                requiredSections: ['summary']
              }
            ]
          }
        },
        mergeConflictTasks: {},
        mergeQueueEntries: {},
        resolvedConditions: {}
      } as unknown as WorkflowRunProjection,
      'review-task.one',
      'ready'
    )

    expect(attemptExecutionPrompt(task, 'mam/review')).toContain('docs/delivery.md')
    expect(attemptExecutionPrompt(task, 'mam/review')).toContain('attempt.author')
  })
})
