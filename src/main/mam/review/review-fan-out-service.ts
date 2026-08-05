import { createHash } from 'node:crypto'
import {
  ReviewSubjectSchema,
  ReviewTaskDefinitionSchema,
  type ReviewSubject,
  type ReviewTaskDefinition
} from '../../../shared/mam/domain/review'
import type { WorkflowRunBundle } from '../../../shared/mam/domain/run-bundle'

export class ReviewFanOutError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message)
    this.name = 'ReviewFanOutError'
  }
}

export function createReviewTasks(input: {
  bundle: WorkflowRunBundle
  reviewNodeId: string
  subject: ReviewSubject
  existingTaskIds?: ReadonlySet<string>
}): readonly ReviewTaskDefinition[] {
  const subject = ReviewSubjectSchema.parse(input.subject)
  const node = input.bundle.definition.nodes.find(
    (candidate) => candidate.id === input.reviewNodeId
  )
  if (!node || node.type !== 'review_gate') {
    fail('review_node_invalid', 'Review fan-out requires a review_gate node')
  }
  const roleId = node.allowedRoleProfileIds[0]!
  const catalog = new Set(input.bundle.run.roleCatalog.map((entry) => entry.roleProfileId))
  if (!catalog.has(roleId)) {
    fail('review_role_not_in_run_catalog', 'Review Role is outside the frozen Run catalog')
  }
  const nodeRun = input.bundle.run.nodeRuns.find((candidate) => candidate.nodeId === node.id)!
  const definitions = Array.from({ length: node.minimumDecisions }, (_, index) =>
    ReviewTaskDefinitionSchema.parse({
      schemaVersion: '1.0.0',
      id: reviewTaskId(input.bundle.run.id, node.id, subject, roleId, index),
      workflowRunId: input.bundle.run.id,
      nodeRunId: nodeRun.id,
      reviewNodeId: node.id,
      subject,
      initialStatus: 'waiting_role_assignment',
      title: `Review ${subject.taskId} (${index + 1}/${node.minimumDecisions})`,
      specification: `Review immutable Attempt ${subject.attemptId} for ${node.id}.`,
      inputArtifacts: node.inputs,
      outputContracts: [node.reportContract],
      recommendedRoleProfileIds: [roleId],
      allowedRoleProfileIds: [roleId]
    })
  )
  if (definitions.some((task) => input.existingTaskIds?.has(task.id))) {
    fail('review_task_id_collision', 'Generated reviewer Task already exists')
  }
  return Object.freeze(definitions)
}

function reviewTaskId(
  runId: string,
  nodeId: string,
  subject: ReviewSubject,
  roleId: string,
  slot: number
): string {
  const digest = createHash('sha256')
    .update(`${runId}\0${nodeId}\0${subject.attemptId}\0${subject.resultHash}\0${roleId}\0${slot}`)
    .digest('hex')
  return `review-task.${digest.slice(0, 40)}`
}

function fail(code: string, message: string): never {
  throw new ReviewFanOutError(code, message)
}
