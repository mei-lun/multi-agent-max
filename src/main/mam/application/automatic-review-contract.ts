import { ArtifactContractSchema, type ArtifactContract } from '../../../shared/mam/domain/artifact'
import type { PreparedAttempt } from './mam-attempt-execution-types'

export const AUTOMATIC_REVIEW_REPORT_JSON_SCHEMA: Readonly<Record<string, unknown>> = {
  type: 'object',
  required: ['status', 'summary'],
  properties: {
    status: { enum: ['approved', 'changes_requested', 'blocked'] },
    summary: { type: 'string', minLength: 1 },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        required: ['severity', 'category', 'summary'],
        properties: {
          severity: { enum: ['blocker', 'high', 'medium', 'low'] },
          category: { type: 'string', minLength: 1 },
          summary: { type: 'string', minLength: 1 },
          filePath: { type: 'string', minLength: 1 },
          line: { type: 'integer', minimum: 1 }
        },
        additionalProperties: true
      }
    }
  },
  additionalProperties: true
}

export function automaticReviewArtifactContract(contract: ArtifactContract): ArtifactContract {
  const { requiredSections: _sections, allowedGlobs: _globs, ...base } = contract
  return ArtifactContractSchema.parse({
    ...base,
    format: 'json-schema',
    jsonSchema: AUTOMATIC_REVIEW_REPORT_JSON_SCHEMA
  })
}

export function normalizePreparedReviewContracts(prepared: PreparedAttempt): PreparedAttempt {
  if (!prepared.task.reviewTask) return prepared
  return {
    ...prepared,
    task: {
      ...prepared.task,
      outputContracts: prepared.task.outputContracts.map(automaticReviewArtifactContract)
    }
  }
}
