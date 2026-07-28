import type { MamSubmitReviewInput } from '../../../shared/mam/application-command'
import { ReviewDecisionSchema, type ReviewTaskDefinition } from '../../../shared/mam/domain/review'
import type { SchedulerCommand } from '../../../shared/mam/scheduler-protocol'

export function buildReviewSubmissionCommand(input: {
  request: MamSubmitReviewInput
  definition: ReviewTaskDefinition
  binding: Readonly<{ roleInstanceId: string; executorInvocationId: string }>
  commandId: string
  createdAt: string
}): Extract<SchedulerCommand, { type: 'record_review' }> {
  const { request, definition, binding } = input
  const reviewId = `review.${input.commandId}`
  const review = ReviewDecisionSchema.parse({
    schemaVersion: '1.0.0',
    id: reviewId,
    workflowRunId: request.workflowRunId,
    reviewNodeId: definition.reviewNodeId,
    attemptId: definition.subject.attemptId,
    subject: definition.subject,
    reviewerTaskId: request.reviewerTaskId,
    reviewerAttemptId: request.reviewerAttemptId,
    reviewerRoleInstanceId: binding.roleInstanceId,
    status: request.status,
    findings: request.findings.map((finding, index) => ({
      schemaVersion: '1.0.0' as const,
      id: `${reviewId}.finding.${String(index + 1)}`,
      attemptId: definition.subject.attemptId,
      severity: finding.severity,
      category: finding.category,
      summary: finding.summary,
      evidence: [],
      ...(finding.filePath ? { filePath: finding.filePath } : {}),
      ...(finding.line ? { line: finding.line } : {})
    })),
    summary: request.summary,
    createdAt: input.createdAt
  })
  return {
    schemaVersion: '1.0.0',
    commandId: input.commandId,
    issuedAt: input.createdAt,
    workflowRunId: request.workflowRunId,
    taskId: request.reviewerTaskId,
    actor: {
      kind: 'executor',
      roleInstanceId: binding.roleInstanceId,
      attemptId: request.reviewerAttemptId,
      executorInvocationId: binding.executorInvocationId
    },
    type: 'record_review',
    attemptId: request.reviewerAttemptId,
    review
  }
}
